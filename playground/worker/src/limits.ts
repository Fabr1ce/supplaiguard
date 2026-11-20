// Pure launch-control logic. The Durable Object persists the state; this decides.
export interface Launch {
  id: string;
  demo: string;
  createdAt: number;
  runId?: number;
  done?: boolean;
}

export interface LimitState {
  launches: Record<string, Launch>;
  active: string | null;
  /** UTC day (YYYY-MM-DD) -> number of launches */
  daily: Record<string, number>;
  /** hashed client -> launch timestamps (ms) */
  clients: Record<string, number[]>;
}

export interface LimitConfig {
  enabled: boolean;
  dailyCap: number;
  perClientPerHour: number;
  /** An active launch older than this is treated as finished, so a lost run cannot block everyone. */
  activeTtlMs: number;
  retainMs: number;
}

export type Decision =
  | { ok: true; state: LimitState }
  | { ok: false; reason: "disabled" | "busy" | "rate_limited" | "daily_cap"; retryAfterSec?: number };

export const emptyState = (): LimitState => ({ launches: {}, active: null, daily: {}, clients: {} });
export const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);

export function decideLaunch(
  s: LimitState,
  now: number,
  client: string,
  launch: Launch,
  cfg: LimitConfig,
): Decision {
  if (!cfg.enabled) return { ok: false, reason: "disabled" };

  const a = s.active ? s.launches[s.active] : undefined;
  if (a && !a.done && now - a.createdAt < cfg.activeTtlMs) {
    return { ok: false, reason: "busy", retryAfterSec: Math.ceil((cfg.activeTtlMs - (now - a.createdAt)) / 1000) };
  }

  const hour = 3_600_000;
  const recent = (s.clients[client] ?? []).filter((t) => now - t < hour);
  if (recent.length >= cfg.perClientPerHour) {
    return { ok: false, reason: "rate_limited", retryAfterSec: Math.ceil((hour - (now - recent[0])) / 1000) };
  }

  const day = utcDay(now);
  if ((s.daily[day] ?? 0) >= cfg.dailyCap) return { ok: false, reason: "daily_cap" };

  const launches: Record<string, Launch> = {};
  for (const [id, l] of Object.entries(s.launches)) if (now - l.createdAt < cfg.retainMs) launches[id] = l;
  launches[launch.id] = launch;

  const clients: Record<string, number[]> = {};
  for (const [c, ts] of Object.entries(s.clients)) {
    const kept = ts.filter((t) => now - t < hour);
    if (kept.length) clients[c] = kept;
  }
  clients[client] = [...recent, now];

  return { ok: true, state: { launches, active: launch.id, daily: { [day]: (s.daily[day] ?? 0) + 1 }, clients } };
}

/** Frees the slot, for example when the dispatch failed or the run reached a terminal state. */
export function finishLaunch(s: LimitState, id: string, refund = false): LimitState {
  const l = s.launches[id];
  if (!l) return s;
  const launches = refund
    ? Object.fromEntries(Object.entries(s.launches).filter(([k]) => k !== id))
    : { ...s.launches, [id]: { ...l, done: true } };
  const daily = { ...s.daily };
  if (refund) {
    const d = utcDay(l.createdAt);
    if (daily[d]) daily[d] -= 1;
  }
  return { ...s, launches, daily, active: s.active === id ? null : s.active };
}
