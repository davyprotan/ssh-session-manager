import { describe, it, expect } from "vitest";
import { suggestProfileForHost } from "./profile-suggest";

const FLEET = [
  // Linux boxes with key-auth profile (id=4)
  { host: "XN-XSVM-S-67-LDP02-GB", profile_id: 4 },
  { host: "XN-XSVM-S-72-LDP02-GB", profile_id: 4 },
  { host: "XN-XSVM-S-454-LDPVM-GB", profile_id: 4 },
  // ADVA OptiSwitches with LDAP password profile (id=5)
  { host: "MR-OSV8-C-1-ALC0G-US", profile_id: 5 },
  { host: "MR-OSV8-C-2-ALC0G-US", profile_id: 5 },
  // Arista with LDAP profile (id=5)
  { host: "AR-7050SX348C8-I-1-LDP02-GB", profile_id: 5 },
  // A misc Linux host with the profile-1 davytan-id_rsa profile
  { host: "configsync.sohonet.internal", profile_id: 1 },
];

describe("suggestProfileForHost", () => {
  it("returns no suggestion when sessions is empty", () => {
    const r = suggestProfileForHost("XN-XSVM-S-NEW-DEVICE", []);
    expect(r.profileId).toBeNull();
  });

  it("returns no suggestion when host has too few segments", () => {
    expect(suggestProfileForHost("a", FLEET).profileId).toBeNull();
    expect(suggestProfileForHost("", FLEET).profileId).toBeNull();
  });

  it("matches a new host into the davytan family by shared prefix", () => {
    const r = suggestProfileForHost("XN-XSVM-S-99-LDPVM-GB", FLEET);
    expect(r.profileId).toBe(4);
    expect(r.matchedSegments).toBeGreaterThanOrEqual(3);
    expect(r.matchedPrefix.toLowerCase()).toContain("xn-xsvm-s");
  });

  it("matches a new host into the LDAP-OSV family", () => {
    const r = suggestProfileForHost("MR-OSV8-C-9-ALC0G-US", FLEET);
    expect(r.profileId).toBe(5);
  });

  it("matches a new Arista by its prefix", () => {
    const r = suggestProfileForHost("AR-7050SX348C8-I-2-NEW-GB", FLEET);
    expect(r.profileId).toBe(5);
  });

  it("returns no suggestion for a host that shares less than MIN_SEGMENTS prefix", () => {
    const r = suggestProfileForHost("totally-different-name-here", FLEET);
    expect(r.profileId).toBeNull();
    expect(r.matchedSegments).toBe(0);
  });

  it("treats . and _ as segment separators alongside -", () => {
    const dotted = [
      { host: "configsync.sohonet.internal", profile_id: 1 },
      { host: "monitoring.sohonet.internal", profile_id: 1 },
    ];
    const r = suggestProfileForHost("backups.sohonet.internal", dotted);
    expect(r.profileId).toBe(1);
    expect(r.matchedSegments).toBe(2);
  });

  it("breaks ties by picking the most common profile among neighbours", () => {
    const sessions = [
      { host: "edge-1-us", profile_id: 10 },
      { host: "edge-2-us", profile_id: 10 },
      { host: "edge-3-us", profile_id: 11 },
    ];
    const r = suggestProfileForHost("edge-4-us", sessions);
    expect(r.profileId).toBe(10);
    expect(r.matchedCount).toBe(3);
  });

  it("is case-insensitive on the segment compare", () => {
    const r = suggestProfileForHost("xn-xsvm-s-99-LDPVM-gb", FLEET);
    expect(r.profileId).toBe(4);
  });

  it("ignores existing sessions whose profile_id is null when those are the only matches", () => {
    const sessions = [
      { host: "edge-1-us", profile_id: null },
      { host: "edge-2-us", profile_id: null },
    ];
    const r = suggestProfileForHost("edge-9-us", sessions);
    expect(r.profileId).toBeNull();
  });

  it("prefers a deeper-prefix match over a shallower one", () => {
    const sessions = [
      { host: "AR-7050SX-1", profile_id: 100 },         // 2 segments shared with target
      { host: "AR-7050SX-A-1", profile_id: 200 },       // 3 segments shared with target
      { host: "AR-9999-X-1", profile_id: 300 },         // only 1 segment shared
    ];
    const r = suggestProfileForHost("AR-7050SX-A-2", sessions);
    expect(r.profileId).toBe(200);
    expect(r.matchedSegments).toBe(3);
  });
});
