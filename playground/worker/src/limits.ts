// Pure launch-control logic. The Durable Object persists the state; this decides.
export interface Launch {
  id: string;
  demo: string;
  createdAt: number;
  runId?: number;
  done?: boolean;
  /** The run was dispatched with propose-fix. Only ever true when the Worker setting allowed it. */
  proposeFix?: boolean;
}

export interface LimitState {
  launches: Record<string, Launch>;
  active: string | null;
  /** UTC day (YYYY-MM-DD) -> number of launches */
  daily: Record<string, number>;
  /** hashed client -> launch timestamps (ms) */
  clients: Record<string, number[]>;
  /** UTC day -> number of propose-fix launches (absent in state saved before the flag existed) */
  fixDaily?: Record<string, number>;
  /** hashed client -> propose-fix launch timestamps (ms) */
  fixClients?: Record<string, number[]>;
}

export interface LimitConfig {
  enabled: boolean;
  dailyCap: number;
  perClientPerHour: number;
  /** An active launch older than this is treated as finished, so a lost run cannot block everyone. */
  activeTtlMs: number;
  retainMs: number;
  /** Propose-fix launches also count against the normal limits; these are the extra, tighter ones. */
  proposeFixDailyCap: number;
  proposeFixPerClientPerDay: number;
}

export type Decision =
  | { ok: true; state: LimitState }
  | { ok: false; reason: "disabled" | "busy" | "rate_limited" | "daily_cap" | "fix_rate_limited" | "fix_daily_cap"; retryAfterSec?: number };

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

  const dayMs = 24 * hour;
  const fixRecent = (s.fixClients?.[client] ?? []).filter((t) => now - t < dayMs);
  if (launch.proposeFix) {
    if (fixRecent.length >= cfg.proposeFixPerClientPerDay) {
      return { ok: false, reason: "fix_rate_limited", retryAfterSec: Math.ceil((dayMs - (now - fixRecent[0])) / 1000) };
    }
    if ((s.fixDaily?.[day] ?? 0) >= cfg.proposeFixDailyCap) return { ok: false, reason: "fix_daily_cap" };
  }

  const launches: Record<string, Launch> = {};
  for (const [id, l] of Object.entries(s.launches)) if (now - l.createdAt < cfg.retainMs) launches[id] = l;
  launches[launch.id] = launch;

  const clients: Record<string, number[]> = {};
  for (const [c, ts] of Object.entries(s.clients)) {
    const kept = ts.filter((t) => now - t < hour);
    if (kept.length) clients[c] = kept;
  }
  clients[client] = [...recent, now];

  const fixClients: Record<string, number[]> = {};
  for (const [c, ts] of Object.entries(s.fixClients ?? {})) {
    const kept = ts.filter((t) => now - t < dayMs);
    if (kept.length) fixClients[c] = kept;
  }
  if (launch.proposeFix) fixClients[client] = [...fixRecent, now];
  const fixDaily = { [day]: (s.fixDaily?.[day] ?? 0) + (launch.proposeFix ? 1 : 0) };

  return { ok: true, state: { launches, active: launch.id, daily: { [day]: (s.daily[day] ?? 0) + 1 }, clients, fixDaily, fixClients } };
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
  let fixDaily = s.fixDaily;
  if (refund && l.proposeFix && fixDaily) {
    const d = utcDay(l.createdAt);
    if (fixDaily[d]) fixDaily = { ...fixDaily, [d]: fixDaily[d] - 1 };
  }
  return { ...s, launches, daily, fixDaily, active: s.active === id ? null : s.active };
}
