import { describe, it, expect, beforeAll, afterAll } from "vitest";
import net from "net";
import type { AddressInfo } from "net";
import { probeTcp } from "./probe";

// Spin up a small TCP listener that can either:
//   - immediately send a fake banner
//   - accept-and-stay-silent
//   - close immediately to force ECONNRESET
// each on a different port, so we can test all probe outcomes.

let bannerPort = 0;
let silentPort = 0;
let bannerServer: net.Server;
let silentServer: net.Server;

function listen(handler: (sock: net.Socket) => void): Promise<{ server: net.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = net.createServer(handler);
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({ server, port: addr.port });
    });
  });
}

beforeAll(async () => {
  ({ server: bannerServer, port: bannerPort } = await listen((sock) => {
    sock.write("SSH-2.0-OpenSSH_test\r\n");
  }));
  ({ server: silentServer, port: silentPort } = await listen(() => {
    // accept and do nothing — connection stays open silently
  }));
});

afterAll(async () => {
  await new Promise((r) => bannerServer.close(() => r(undefined)));
  await new Promise((r) => silentServer.close(() => r(undefined)));
});

describe("probeTcp", () => {
  it("reports reachable + banner for a host that sends an SSH greeting", async () => {
    const r = await probeTcp("127.0.0.1", bannerPort, { timeoutMs: 1500 });
    expect(r.reachable).toBe(true);
    if (r.reachable) {
      expect(r.banner).toMatch(/^SSH-/);
      expect(r.latencyMs).toBeGreaterThanOrEqual(0);
      expect(r.latencyMs).toBeLessThan(1500);
    }
  });

  it("reports reachable without banner when the server is silent", async () => {
    const r = await probeTcp("127.0.0.1", silentPort, { timeoutMs: 1500, bannerWindowMs: 150 });
    expect(r.reachable).toBe(true);
    if (r.reachable) expect(r.banner).toBeUndefined();
  });

  it("returns ECONNREFUSED on a closed port", async () => {
    // Find a port that's almost certainly closed: bind, get port, close, then probe.
    const tmp = net.createServer();
    await new Promise<void>((res) => tmp.listen(0, "127.0.0.1", () => res()));
    const closedPort = (tmp.address() as AddressInfo).port;
    await new Promise<void>((res) => tmp.close(() => res()));

    const r = await probeTcp("127.0.0.1", closedPort, { timeoutMs: 800 });
    expect(r.reachable).toBe(false);
    if (!r.reachable) expect(r.error).toMatch(/ECONNREFUSED|EADDRNOTAVAIL/);
  });

  it("returns timeout on a reserved-but-unreachable IP", async () => {
    // 192.0.2.0/24 is TEST-NET-1 reserved for documentation. Connections to
    // it should never succeed; whether it errors or times out depends on the
    // OS routing table, but it should NOT be reachable=true.
    const r = await probeTcp("192.0.2.1", 22, { timeoutMs: 600 });
    expect(r.reachable).toBe(false);
  }, 5000);

  it("returns ENOTFOUND for an obviously bogus hostname", async () => {
    const r = await probeTcp("does-not-resolve.invalid.example", 22, { timeoutMs: 800 });
    expect(r.reachable).toBe(false);
    if (!r.reachable) expect(r.error).toMatch(/ENOTFOUND|EAI_AGAIN/);
  });
});
