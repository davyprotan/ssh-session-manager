import { describe, it, expect } from "vitest";
import { parseHostInput } from "./host-input";

describe("parseHostInput", () => {
  it("parses a bare hostname", () => {
    expect(parseHostInput(" web-01.example.com ")).toEqual({ host: "web-01.example.com", port: undefined, user: undefined });
  });
  it("parses host:port", () => {
    expect(parseHostInput("10.0.0.5:2222")).toEqual({ host: "10.0.0.5", port: 2222, user: undefined });
  });
  it("parses user@host:port", () => {
    expect(parseHostInput("ops@db-02:22")).toEqual({ host: "db-02", port: 22, user: "ops" });
  });
  it("strips an ssh prefix or scheme", () => {
    expect(parseHostInput("ssh root@box")).toEqual({ host: "box", port: undefined, user: "root" });
    expect(parseHostInput("ssh://box:2200/")).toEqual({ host: "box", port: 2200, user: undefined });
  });
  it("handles IPv6, bare and bracketed", () => {
    expect(parseHostInput("fe80::1")).toEqual({ host: "fe80::1", port: undefined, user: undefined });
    expect(parseHostInput("[fe80::1]:2222")).toEqual({ host: "fe80::1", port: 2222, user: undefined });
  });
  it("rejects junk", () => {
    expect(parseHostInput("")).toBeNull();
    expect(parseHostInput("host:abc")).toBeNull();
    expect(parseHostInput("host:70000")).toBeNull();
    expect(parseHostInput("bad host")).toBeNull();
    expect(parseHostInput("a;rm -rf@host")).toBeNull();
  });
});
