"use client";

// Two-step Quick Connect flow:
//   1. user types host + (optional) port → Enter or "Check"
//   2. we probe TCP reachability via /api/probe (validation, error feedback)
//   3. on reachable, show profile cards. Clicking a card connects immediately.
//
// Auto-suggestion (`suggestProfileForHost`) still runs and gives the most
// likely profile a "Suggested" badge, but it doesn't pre-select anything —
// the user always confirms by clicking. This avoids "I clicked the connect
// button without realising it had picked the wrong profile" surprises.

import { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Zap, Check, BookmarkPlus, KeyRound, Sparkles,
  Loader2, AlertCircle, Wifi, ChevronLeft,
  Key, Lock, ShieldCheck, Star,
} from "lucide-react";
import ProfileDialog from "./ProfileDialog";
import SetupPasswordlessDialog from "./SetupPasswordlessDialog";
import { COLOR_HEX, type ProfileColor } from "@/lib/profile-colors";
import { toast } from "sonner";
import type { Profile, Session } from "@/lib/types";
import { suggestProfileForHost, type SuggestResult } from "@/lib/profile-suggest";

interface Props {
  open: boolean;
  onClose: () => void;
  profiles: Profile[];
  allSessions?: Session[];
  useBuiltInTerminal?: boolean;
  onOpenSavedInTerminal?: (s: { id: number; name: string }) => void;
  onOpenAdHocInTerminal?: (opts: { host: string; profileId: number; port?: number; jumpHost?: string; label?: string }) => void;
  onProfilesChanged: () => void;
  onSessionSaved?: (saved?: { id: number; name: string; host: string; profile_auth_type?: string | null }) => void;
}

type ProbeOk = { reachable: true; latencyMs: number; banner?: string };
type ProbeErr = { reachable: false; latencyMs: number; error: string };
type ProbeResult = ProbeOk | ProbeErr;

type Step =
  | { phase: "host" }
  | { phase: "probing" }
  | { phase: "reachable"; result: ProbeOk }
  | { phase: "unreachable"; result: ProbeErr };

export default function QuickConnectDialog({
  open, onClose, profiles, allSessions = [],
  useBuiltInTerminal = false, onOpenSavedInTerminal, onOpenAdHocInTerminal,
  onProfilesChanged, onSessionSaved,
}: Props) {
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [step, setStep] = useState<Step>({ phase: "host" });
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [passwordlessOpen, setPasswordlessOpen] = useState(false);
  const [passwordlessProfile, setPasswordlessProfile] = useState<Profile | null>(null);
  const [saveSession, setSaveSession] = useState(false);
  const [sessionName, setSessionName] = useState("");
  const [suggestion, setSuggestion] = useState<SuggestResult | null>(null);
  const [connecting, setConnecting] = useState(false);

  // Reset on every open
  useEffect(() => {
    if (open) {
      setHost("");
      setPort("");
      setStep({ phase: "host" });
      setSaveSession(false);
      setSessionName("");
      setSuggestion(null);
      setConnecting(false);
    }
  }, [open]);

  // Suggest a profile based on hostname pattern.
  useEffect(() => {
    if (!host.trim()) { setSuggestion(null); return; }
    const r = suggestProfileForHost(
      host.trim(),
      allSessions.map((s) => ({ host: s.host, profile_id: s.profile_id })),
    );
    setSuggestion(r);
  }, [host, allSessions]);

  // Default session name to host
  useEffect(() => {
    if (saveSession && host && !sessionName) setSessionName(host);
  }, [host, saveSession, sessionName]);

  const handleProbe = useCallback(async () => {
    const trimmedHost = host.trim();
    if (!trimmedHost) return;
    setStep({ phase: "probing" });

    try {
      const res = await fetch("/api/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host: trimmedHost,
          port: port ? parseInt(port) : 22,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setStep({ phase: "unreachable", result: { reachable: false, latencyMs: 0, error: err.error || `HTTP ${res.status}` } });
        return;
      }
      const data = (await res.json()) as ProbeResult;
      if (data.reachable) {
        setStep({ phase: "reachable", result: data });
      } else {
        setStep({ phase: "unreachable", result: data });
      }
    } catch (e) {
      setStep({ phase: "unreachable", result: { reachable: false, latencyMs: 0, error: e instanceof Error ? e.message : "fetch failed" } });
    }
  }, [host, port]);

  const handleProfileClick = useCallback(async (p: Profile) => {
    if (!host.trim()) return;
    setConnecting(true);

    // Save first if requested.
    let savedSessionId: number | null = null;
    if (saveSession) {
      const finalName = (sessionName || host).trim();
      const saveRes = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: finalName,
          host: host.trim(),
          port: port ? parseInt(port) : 22,
          profile_id: p.id,
          tags: [],
        }),
      });
      if (saveRes.ok) {
        const saved = await saveRes.json();
        savedSessionId = saved.id;
        toast.success(`Saved session "${finalName}"`);
        onSessionSaved?.(saved);
      } else {
        const err = await saveRes.json().catch(() => ({}));
        toast.error("Failed to save session", { description: err.error });
        setConnecting(false);
        return;
      }
    }

    // Built-in terminal path
    if (useBuiltInTerminal) {
      setConnecting(false);
      if (savedSessionId != null && onOpenSavedInTerminal) {
        onOpenSavedInTerminal({ id: savedSessionId, name: (sessionName || host).trim() });
      } else if (onOpenAdHocInTerminal) {
        onOpenAdHocInTerminal({
          host: host.trim(),
          profileId: p.id,
          port: port ? parseInt(port) : undefined,
          label: host.trim(),
        });
      }
      onClose();
      return;
    }

    // Legacy iTerm path
    const connectBody = savedSessionId
      ? { session_id: savedSessionId }
      : {
          host: host.trim(),
          profile_id: p.id,
          port: port ? parseInt(port) : undefined,
        };
    const res = await fetch("/api/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(connectBody),
    });
    setConnecting(false);
    if (res.ok) {
      const data = await res.json();
      toast.success(`Connecting to ${host}`, { description: data.command });
      onClose();
    } else {
      toast.error("Failed to connect");
    }
  }, [host, port, saveSession, sessionName, useBuiltInTerminal, onOpenSavedInTerminal, onOpenAdHocInTerminal, onSessionSaved, onClose]);

  const canProbe = host.trim().length > 0 && step.phase !== "probing";

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: "color-mix(in srgb, var(--accent) 15%, transparent)" }}>
                <Zap className="h-4 w-4" style={{ color: "var(--accent)" }} />
              </div>
              Quick Connect
            </DialogTitle>
            <DialogDescription style={{ color: "var(--muted-fg)" }}>
              {step.phase === "host" && "Type a host. We'll check it's reachable, then you'll pick credentials."}
              {step.phase === "probing" && `Probing ${host.trim()}…`}
              {step.phase === "reachable" && "Reachable. Click a profile to connect."}
              {step.phase === "unreachable" && "Couldn't reach the host."}
            </DialogDescription>
          </DialogHeader>

          {step.phase === "host" && (
            <div className="space-y-4 py-1">
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-[12.5px] font-semibold" style={{ color: "var(--muted-fg)" }}>Host</Label>
                  <Input
                    autoFocus
                    className="font-mono"
                    placeholder="server.example.com"
                    value={host}
                    onChange={e => setHost(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && canProbe) handleProbe(); }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[12.5px] font-semibold" style={{ color: "var(--muted-fg)" }}>Port</Label>
                  <Input
                    type="number"
                    placeholder="22"
                    value={port}
                    onChange={e => setPort(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && canProbe) handleProbe(); }}
                  />
                </div>
              </div>

              {/* Save toggle stays visible on the first step */}
              <SaveToggle saveSession={saveSession} setSaveSession={setSaveSession} sessionName={sessionName} setSessionName={setSessionName} hostHint={host} />
            </div>
          )}

          {step.phase === "probing" && (
            <div className="py-8 flex flex-col items-center gap-3 text-center">
              <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--accent)" }} />
              <p className="text-[13px]" style={{ color: "var(--muted-fg)" }}>
                Connecting to <span className="font-mono" style={{ color: "var(--foreground)" }}>{host.trim()}{port ? `:${port}` : ":22"}</span>…
              </p>
            </div>
          )}

          {step.phase === "unreachable" && (
            <div className="py-6 space-y-4">
              <div className="rounded-lg border p-3 flex items-start gap-2" style={{
                background: "color-mix(in srgb, var(--destructive) 6%, transparent)",
                borderColor: "color-mix(in srgb, var(--destructive) 30%, transparent)",
              }}>
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" style={{ color: "var(--destructive)" }} />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold" style={{ color: "var(--destructive)" }}>
                    Can&apos;t reach {host.trim()}{port ? `:${port}` : ":22"}
                  </p>
                  <p className="text-[12px] mt-0.5 font-mono break-all" style={{ color: "var(--muted-fg)" }}>
                    {explainProbeError(step.result.error)}
                  </p>
                </div>
              </div>
            </div>
          )}

          {step.phase === "reachable" && (
            <div className="space-y-4 py-1">
              {/* Reachability summary */}
              <div className="flex items-start gap-2 rounded-lg border px-3 py-2" style={{
                borderColor: "color-mix(in srgb, var(--accent) 30%, transparent)",
                background: "color-mix(in srgb, var(--accent) 6%, transparent)",
              }}>
                <Wifi className="h-4 w-4 shrink-0 mt-0.5" style={{ color: "var(--accent)" }} />
                <div className="flex-1 min-w-0 text-[12px]">
                  <p className="font-semibold" style={{ color: "var(--foreground)" }}>
                    Reachable in {step.result.latencyMs} ms
                  </p>
                  {step.result.banner && (
                    <p className="font-mono mt-0.5 truncate" style={{ color: "var(--muted-fg)" }} title={step.result.banner}>
                      {step.result.banner}
                    </p>
                  )}
                </div>
              </div>

              {/* Click-to-connect profile cards */}
              <div className="space-y-2">
                <Label className="text-[12.5px] font-semibold" style={{ color: "var(--muted-fg)" }}>
                  Click a profile to connect
                </Label>
                {suggestion && suggestion.profileId != null && (
                  <div className="flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-[11.5px]" style={{
                    background: "color-mix(in srgb, var(--accent) 8%, transparent)",
                    color: "var(--muted-fg)",
                  }}>
                    <Sparkles className="h-3.5 w-3.5 shrink-0 mt-px" style={{ color: "var(--accent)" }} />
                    <span>
                      Most likely:{" "}
                      <span className="font-mono" style={{ color: "var(--foreground)" }}>{suggestion.matchedPrefix}</span>{" "}
                      pattern ({suggestion.matchedCount} similar host{suggestion.matchedCount === 1 ? "" : "s"})
                    </span>
                  </div>
                )}

                {profiles.length === 0 ? (
                  <button
                    onClick={() => setProfileDialogOpen(true)}
                    className="w-full rounded-xl border border-dashed p-4 text-center transition-colors"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <p className="text-[13px] font-semibold" style={{ color: "var(--foreground)" }}>No profiles yet</p>
                    <p className="text-[12px]" style={{ color: "var(--muted-fg)" }}>Click to create one and continue</p>
                  </button>
                ) : (
                  <div className="grid grid-cols-1 gap-1.5">
                    {profiles.map((p) => (
                      <ConnectButton
                        key={p.id}
                        profile={p}
                        suggested={suggestion?.profileId === p.id}
                        connecting={connecting}
                        onClick={() => handleProfileClick(p)}
                        onSetupPasswordless={p.auth_type === "password" ? () => {
                          setPasswordlessProfile(p);
                          setPasswordlessOpen(true);
                        } : undefined}
                      />
                    ))}
                  </div>
                )}
              </div>

              <SaveToggle saveSession={saveSession} setSaveSession={setSaveSession} sessionName={sessionName} setSessionName={setSessionName} hostHint={host} />
            </div>
          )}

          <DialogFooter className="gap-2 flex-wrap">
            {step.phase === "host" && (
              <>
                <Button variant="outline" onClick={onClose}>Cancel</Button>
                <Button
                  onClick={handleProbe}
                  disabled={!canProbe}
                  className="gap-1.5"
                  style={{ background: "var(--accent)", color: "var(--accent-foreground)", border: "none" }}
                >
                  <Wifi className="h-3.5 w-3.5" />
                  Check
                </Button>
              </>
            )}
            {step.phase === "probing" && (
              <Button variant="outline" onClick={() => setStep({ phase: "host" })}>Cancel</Button>
            )}
            {step.phase === "reachable" && (
              <>
                <Button variant="outline" onClick={() => setStep({ phase: "host" })} className="mr-auto gap-1">
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Back
                </Button>
                <Button variant="outline" onClick={onClose}>Cancel</Button>
              </>
            )}
            {step.phase === "unreachable" && (
              <>
                <Button variant="outline" onClick={() => setStep({ phase: "host" })} className="mr-auto">Edit host</Button>
                <Button variant="outline" onClick={onClose}>Cancel</Button>
                <Button
                  onClick={handleProbe}
                  className="gap-1.5"
                  style={{ background: "var(--accent)", color: "var(--accent-foreground)", border: "none" }}
                >
                  <Wifi className="h-3.5 w-3.5" />
                  Try again
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ProfileDialog
        open={profileDialogOpen}
        onClose={() => setProfileDialogOpen(false)}
        onSave={() => onProfilesChanged()}
        backLabel="Back to quick connect"
      />

      <SetupPasswordlessDialog
        open={passwordlessOpen}
        onClose={() => { setPasswordlessOpen(false); setPasswordlessProfile(null); }}
        target={{ host: host.trim(), port: port ? parseInt(port) : undefined, jumpHost: null }}
        profile={passwordlessProfile}
        onDone={() => { onProfilesChanged(); }}
      />
    </>
  );
}

function SaveToggle({ saveSession, setSaveSession, sessionName, setSessionName, hostHint }: {
  saveSession: boolean;
  setSaveSession: (v: boolean) => void;
  sessionName: string;
  setSessionName: (v: string) => void;
  hostHint: string;
}) {
  return (
    <>
      <button
        type="button"
        onClick={() => setSaveSession(!saveSession)}
        className="flex items-center gap-3 w-full rounded-lg px-3 py-2 transition-colors text-left"
        style={{
          background: saveSession ? "color-mix(in srgb, var(--accent) 8%, transparent)" : "transparent",
          border: `1px solid ${saveSession ? "color-mix(in srgb, var(--accent) 40%, transparent)" : "var(--border)"}`,
        }}
      >
        <div
          className="flex h-5 w-5 items-center justify-center rounded transition-colors shrink-0"
          style={{
            background: saveSession ? "var(--accent)" : "transparent",
            border: `1.5px solid ${saveSession ? "var(--accent)" : "var(--border)"}`,
          }}
        >
          {saveSession && <Check className="h-3.5 w-3.5" style={{ color: "var(--accent-foreground)" }} strokeWidth={3} />}
        </div>
        <div className="flex-1">
          <p className="text-[14px] font-semibold flex items-center gap-1.5" style={{ color: "var(--foreground)" }}>
            <BookmarkPlus className="h-3.5 w-3.5" style={{ color: saveSession ? "var(--accent)" : "var(--muted-fg)" }} />
            Save as a session
          </p>
          <p className="text-[12px] mt-0.5" style={{ color: "var(--muted-fg)" }}>
            So you can connect again from the dashboard
          </p>
        </div>
      </button>
      {saveSession && (
        <div className="space-y-1.5 pl-3 border-l-2" style={{ borderColor: "color-mix(in srgb, var(--accent) 30%, transparent)" }}>
          <Label className="text-[12.5px] font-semibold" style={{ color: "var(--muted-fg)" }}>Session name</Label>
          <Input
            placeholder={hostHint || "My Server"}
            value={sessionName}
            onChange={e => setSessionName(e.target.value)}
          />
        </div>
      )}
    </>
  );
}

function ConnectButton({ profile, suggested, connecting, onClick, onSetupPasswordless }: {
  profile: Profile;
  suggested: boolean;
  connecting: boolean;
  onClick: () => void;
  onSetupPasswordless?: () => void;
}) {
  const color = COLOR_HEX[profile.color as ProfileColor] || COLOR_HEX.cyan;
  const isPassword = profile.auth_type === "password";

  return (
    <div className="relative">
      <button
        onClick={onClick}
        disabled={connecting}
        className="group w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-all duration-150 text-left disabled:opacity-50"
        style={{
          background: suggested ? `${color}10` : "var(--card)",
          borderColor: suggested ? `${color}80` : "var(--border)",
          boxShadow: suggested ? `0 0 0 1px ${color}40, 0 4px 14px ${color}15` : "none",
        }}
        onMouseEnter={e => {
          if (!connecting) {
            (e.currentTarget as HTMLButtonElement).style.background = `${color}1a`;
            (e.currentTarget as HTMLButtonElement).style.borderColor = `${color}b3`;
          }
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLButtonElement).style.background = suggested ? `${color}10` : "var(--card)";
          (e.currentTarget as HTMLButtonElement).style.borderColor = suggested ? `${color}80` : "var(--border)";
        }}
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: `${color}1a`, color }}>
          {isPassword ? <Lock className="h-4 w-4" /> : profile.auth_type === "key_with_passphrase" ? <ShieldCheck className="h-4 w-4" /> : <Key className="h-4 w-4" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-[14px] font-semibold truncate" style={{ color: "var(--foreground)" }}>{profile.name}</p>
            {profile.is_default ? <Star className="h-3.5 w-3.5 shrink-0 fill-current" style={{ color }} /> : null}
            {suggested && (
              <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide shrink-0" style={{ background: `${color}26`, color }}>
                <Sparkles className="h-2.5 w-2.5" />
                Suggested
              </span>
            )}
          </div>
          <p className="text-[12.5px] font-mono mt-0.5 truncate" style={{ color: "var(--muted-fg)" }}>{profile.username}</p>
        </div>
        <span className="text-[11px] font-semibold shrink-0 px-2 py-0.5 rounded transition-opacity opacity-60 group-hover:opacity-100" style={{ color, background: `${color}14` }}>
          Connect
        </span>
      </button>

      {/* Inline shortcut for password-auth profiles to set up passwordless first */}
      {onSetupPasswordless && (
        <button
          onClick={(e) => { e.stopPropagation(); onSetupPasswordless(); }}
          className="absolute right-2 top-2 inline-flex items-center gap-1 text-[10.5px] font-semibold rounded px-1.5 py-0.5 transition-opacity"
          style={{ color: "#fbbf24", background: "color-mix(in srgb, #fbbf24 8%, transparent)" }}
          title="Install your SSH key on this host to stop typing passwords"
        >
          <KeyRound className="h-3 w-3" />
          passwordless
        </button>
      )}
    </div>
  );
}

function explainProbeError(code: string): string {
  switch (code) {
    case "ETIMEDOUT":
    case "timeout":
      return "TCP timeout — the host took too long to respond. Could be down, blocked by firewall, or wrong port.";
    case "ECONNREFUSED":
      return "Connection refused — the port is closed. Is sshd running on that port?";
    case "ENOTFOUND":
      return "DNS lookup failed — host doesn't resolve. Check the name.";
    case "EHOSTUNREACH":
      return "Host unreachable — no route from this machine.";
    case "ENETUNREACH":
      return "Network unreachable — your network can't reach that subnet.";
    default:
      return code;
  }
}
