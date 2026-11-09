"use client";

// Shared state for "type a host, pick how to connect" UIs (the header host
// field and the empty-tab launcher): parses the input, picks a profile and
// probes reachability in the background. The probe is a hint only — it never
// blocks connecting (it can't see through jump hosts).

import { useEffect, useMemo, useState } from "react";
import { parseHostInput, type ParsedHostInput } from "@/lib/host-input";
import { suggestProfileForHost } from "@/lib/profile-suggest";
import type { Profile, Session } from "@/lib/types";

export interface LaunchRequest {
  host: string;
  port?: number;
  /** null = manual: no profile, ssh prompts for the password in the terminal. */
  profileId: number | null;
  /** Manual only. Blank = ssh's default (your local username). */
  username?: string;
}

/** Profile selection: a profile id, or "manual" (enter credentials yourself). */
export type ProfileChoice = number | "manual";

export type Reach =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "ok" }
  | { state: "fail"; error: string };

export function useHostLaunch(profiles: Profile[], sessions: Session[]) {
  const [input, setInputRaw] = useState("");
  const [pickedProfileId, setPickedProfileId] = useState<ProfileChoice | null>(null);
  const [manualUser, setManualUser] = useState("");
  const [reach, setReach] = useState<Reach>({ state: "idle" });

  const setInput = (v: string) => { setInputRaw(v); setPickedProfileId(null); };

  const parsed: ParsedHostInput | null = useMemo(() => parseHostInput(input), [input]);
  const invalid = input.trim().length > 0 && !parsed;

  // A username typed as user@host wins, then the hostname pattern match,
  // then the default profile, then the first one.
  const suggestedProfileId = useMemo(() => {
    if (profiles.length === 0) return null;
    if (parsed?.user) {
      // A typed username no profile uses → manual, so that user is honoured.
      const byUser = profiles.find((p) => p.username === parsed.user);
      return byUser ? byUser.id : null;
    }
    if (parsed?.host) {
      const r = suggestProfileForHost(parsed.host, sessions.map((s) => ({ host: s.host, profile_id: s.profile_id })));
      if (r.profileId != null && profiles.some((p) => p.id === r.profileId)) return r.profileId;
    }
    return (profiles.find((p) => p.is_default) ?? profiles[0]).id;
  }, [profiles, sessions, parsed]);

  // No profiles at all → manual is the only (and default) choice.
  const choice: ProfileChoice = pickedProfileId === "manual"
    ? "manual"
    : pickedProfileId != null && profiles.some((p) => p.id === pickedProfileId)
      ? pickedProfileId
      : suggestedProfileId ?? "manual";
  const manual = choice === "manual";
  const profileId = manual ? null : choice;

  const probeHost = parsed?.host;
  const probePort = parsed?.port ?? (profileId != null ? profiles.find((p) => p.id === profileId)?.port : undefined) ?? 22;
  useEffect(() => {
    let cancelled = false;
    if (!probeHost) {
      void Promise.resolve().then(() => { if (!cancelled) setReach({ state: "idle" }); });
      return () => { cancelled = true; };
    }
    const t = setTimeout(async () => {
      setReach({ state: "checking" });
      try {
        const res = await fetch("/api/probe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ host: probeHost, port: probePort }),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && data.reachable) setReach({ state: "ok" });
        else setReach({ state: "fail", error: data.error || `HTTP ${res.status}` });
      } catch (e) {
        if (!cancelled) setReach({ state: "fail", error: e instanceof Error ? e.message : "probe failed" });
      }
    }, 450);
    return () => { cancelled = true; clearTimeout(t); };
  }, [probeHost, probePort]);

  const request: LaunchRequest | null = !parsed
    ? null
    : manual
      ? { host: parsed.host, port: parsed.port, profileId: null, username: (parsed.user ?? manualUser).trim() || undefined }
      : { host: parsed.host, port: parsed.port, profileId };

  return {
    input, setInput, parsed, invalid,
    choice, manual, profileId, suggestedProfileId,
    pickedProfile: pickedProfileId != null,
    pickProfile: setPickedProfileId,
    /** Manual mode: username field (hidden when typed as user@host). */
    manualUser, setManualUser,
    needsManualUser: manual && !parsed?.user,
    reach, request,
    /** The typed user@ matches no profile — ssh will use the profile's user. */
    userMismatch: !manual && !!parsed?.user && !profiles.some((p) => p.username === parsed.user),
  };
}
