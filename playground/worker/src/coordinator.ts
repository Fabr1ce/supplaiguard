import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import { decideLaunch, emptyState, finishLaunch, type Decision, type Launch, type LimitConfig, type LimitState } from "./limits";

/** One global instance. Serialises launches so the concurrency and daily limits cannot be raced. */
export class Coordinator extends DurableObject<Env> {
  private async load(): Promise<LimitState> {
    return (await this.ctx.storage.get<LimitState>("s")) ?? emptyState();
  }

  async reserve(client: string, demo: string, cfg: LimitConfig, proposeFix = false, scanUrl?: { repo: string; ref: string | null }, privateDemo = false): Promise<Decision & { launchId?: string }> {
    const s = await this.load();
    const id = "pg-" + [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const launch: Launch = { id, demo, createdAt: Date.now(), ...(proposeFix ? { proposeFix: true } : {}), ...(scanUrl ? { scanUrl } : {}), ...(privateDemo ? { privateDemo: true } : {}) };
    const d = decideLaunch(s, Date.now(), client, launch, cfg);
    if (d.ok) await this.ctx.storage.put("s", d.state);
    return d.ok ? { ...d, launchId: id } : d;
  }

  async get(id: string): Promise<Launch | null> {
    return (await this.load()).launches[id] ?? null;
  }

  async setRun(id: string, runId: number): Promise<void> {
    const s = await this.load();
    const l = s.launches[id];
    if (l) await this.ctx.storage.put("s", { ...s, launches: { ...s.launches, [id]: { ...l, runId } } });
  }

  async finish(id: string, refund = false): Promise<void> {
    await this.ctx.storage.put("s", finishLaunch(await this.load(), id, refund));
  }

  /** Lightweight per-client counter for read endpoints (status, results). */
  async allowRead(client: string, perMinute: number): Promise<boolean> {
    const key = `r:${client}`;
    const now = Date.now();
    const ts = ((await this.ctx.storage.get<number[]>(key)) ?? []).filter((t) => now - t < 60_000);
    if (ts.length >= perMinute) return false;
    await this.ctx.storage.put(key, [...ts, now]);
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(now + 3_600_000);
    return true;
  }

  /** Drops the read counters so they do not accumulate. */
  async alarm(): Promise<void> {
    await this.ctx.storage.delete([...(await this.ctx.storage.list({ prefix: "r:" })).keys()]);
  }
}
