// Pure launch-control logic. The Durable Object persists the state; this decides.
export interface Launch {
  id: string;
  demo: string;
  createdAt: number;
  runId?: number;
  done?: boolean;
  /** The run was dispatched with propose-fix. Only ever true when the Worker setting allowed it. */
  proposeFix?: boolean;
  /** A scan-by-URL launch. Only ever set when the Worker setting allowed it. `repo` and `ref` are the NORMALIZED, validated values. */
  scanUrl?: { repo: string; ref: string | null };
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
  /** UTC day -> number of scan-by-URL launches (absent in state saved before the flag existed) */
  urlDaily?: Record<string, number>;
  /** hashed client -> scan-by-URL launch timestamps (ms) */
  urlClients?: Record<string, number[]>;
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
  /** Scan-by-URL launches also count against the normal limits; these are the extra, tighter ones. */
  scanUrlDailyCap?: number;
  scanUrlPerClientPerDay?: number;
}

export type Decision =
  | { ok: true; state: LimitState }
  | { ok: false; reason: "disabled" | "busy" | "rate_limited" | "daily_cap" | "fix_rate_limited" | "fix_daily_cap" | "scan_url_rate_limited" | "scan_url_daily_cap"; retryAfterSec?: number };

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

  const urlRecent = (s.urlClients?.[client] ?? []).filter((t) => now - t < dayMs);
  if (launch.scanUrl) {
    if (urlRecent.length >= (cfg.scanUrlPerClientPerDay ?? 1)) {
      return { ok: false, reason: "scan_url_rate_limited", retryAfterSec: Math.ceil((dayMs - (now - urlRecent[0])) / 1000) };
    }
    if ((s.urlDaily?.[day] ?? 0) >= (cfg.scanUrlDailyCap ?? 5)) return { ok: false, reason: "scan_url_daily_cap" };
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

  const urlClients: Record<string, number[]> = {};
  for (const [c, ts] of Object.entries(s.urlClients ?? {})) {
    const kept = ts.filter((t) => now - t < dayMs);
    if (kept.length) urlClients[c] = kept;
  }
  // Stamped with the launch's own createdAt so a refund can remove exactly this entry.
  if (launch.scanUrl) urlClients[client] = [...urlRecent, launch.createdAt];
  const urlDaily = { [day]: (s.urlDaily?.[day] ?? 0) + (launch.scanUrl ? 1 : 0) };

  return {
    ok: true,
    state: { launches, active: launch.id, daily: { [day]: (s.daily[day] ?? 0) + 1 }, clients, fixDaily, fixClients, urlDaily, urlClients },
  };
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
  let urlDaily = s.urlDaily;
  let urlClients = s.urlClients;
  if (refund && l.scanUrl) {
    const d = utcDay(l.createdAt);
    if (urlDaily?.[d]) urlDaily = { ...urlDaily, [d]: urlDaily[d] - 1 };
    // The failed launch no longer uses the client's one daily scan: drop its most recent timestamp for the same moment.
    if (urlClients) {
      urlClients = Object.fromEntries(
        Object.entries(urlClients).map(([c, ts]) => [c, ts.filter((t) => t !== l.createdAt)]),
      );
    }
  }
  return { ...s, launches, daily, fixDaily, urlDaily, urlClients, active: s.active === id ? null : s.active };
}
