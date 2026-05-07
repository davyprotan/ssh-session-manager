// Pure-ish TCP-connect probe helper. Server-only.
// Used by /api/probe to confirm a host is reachable BEFORE asking the user
// to pick a profile in Quick Connect.

import net from "net";

export interface ProbeOk {
  reachable: true;
  latencyMs: number;
  banner?: string;
}
export interface ProbeErr {
  reachable: false;
  latencyMs: number;
  error: string;
}
export type ProbeResult = ProbeOk | ProbeErr;

export interface ProbeOptions {
  /** TCP connect timeout. */
  timeoutMs: number;
  /** Wait this long after connect for the first inbound chunk (banner). */
  bannerWindowMs?: number;
}

const DEFAULT_BANNER_WINDOW_MS = 800;

export function probeTcp(host: string, port: number, opts: ProbeOptions): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    let resolved = false;
    const finish = (r: ProbeResult) => {
      if (resolved) return;
      resolved = true;
      try { sock.destroy(); } catch { /* ignore */ }
      resolve(r);
    };

    const sock = net.createConnection({ host, port, family: 0 });
    sock.setTimeout(opts.timeoutMs);

    let banner: string | undefined;

    sock.on("connect", () => {
      const win = opts.bannerWindowMs ?? DEFAULT_BANNER_WINDOW_MS;
      const bannerTimer = setTimeout(() => {
        finish({ reachable: true, latencyMs: Date.now() - start, banner });
      }, win);

      sock.once("data", (chunk) => {
        clearTimeout(bannerTimer);
        const text = chunk.toString("utf8", 0, 256);
        const firstLine = text.split(/\r?\n/, 1)[0].slice(0, 200);
        banner = firstLine;
        finish({ reachable: true, latencyMs: Date.now() - start, banner });
      });
    });

    sock.on("timeout", () => {
      finish({ reachable: false, latencyMs: Date.now() - start, error: "timeout" });
    });

    sock.on("error", (err) => {
      const msg = (err as NodeJS.ErrnoException).code || err.message || "error";
      finish({ reachable: false, latencyMs: Date.now() - start, error: msg });
    });
  });
}
