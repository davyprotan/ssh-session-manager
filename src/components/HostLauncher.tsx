"use client";

// "New tab" launcher shown in the terminal pane: type a host, pick a profile,
// then Quick connect (↵), Save & connect (⌘/Ctrl+↵) or open the full session
// editor pre-filled.

import { useEffect, useMemo, useRef, useState } from "react";
import { Zap, Bookmark, SlidersHorizontal, Plus, Loader2, KeyRound } from "lucide-react";
import { COLOR_HEX, type ProfileColor } from "@/lib/profile-colors";
import { useHostLaunch, type LaunchRequest, type Reach, type ProfileChoice } from "@/lib/use-host-launch";
import type { HistoryEntry, Profile, Session } from "@/lib/types";

export type { LaunchRequest } from "@/lib/use-host-launch";

interface Props {
  profiles: Profile[];
  sessions: Session[];
  history: HistoryEntry[];
  /** Changes whenever the launcher should grab keyboard focus. */
  focusRequest?: number;
  onQuickConnect: (req: LaunchRequest) => void;
  onSaveAndConnect: (req: LaunchRequest) => Promise<boolean>;
  onMoreOptions: (prefill: { host: string; port?: number }) => void;
  onNewProfile: () => void;
}

export const MOD_KEY = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform) ? "⌘" : "Ctrl+";

export default function HostLauncher({
  profiles, sessions, history, focusRequest = 0,
  onQuickConnect, onSaveAndConnect, onMoreOptions, onNewProfile,
}: Props) {
  const h = useHostLaunch(profiles, sessions);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, [focusRequest]);

  const canConnect = !!h.request && !busy;

  function quick() {
    if (!canConnect || !h.request) return;
    onQuickConnect(h.request);
    h.setInput("");
  }

  async function saveAndConnect() {
    if (!canConnect || !h.request || h.manual) return;
    setBusy(true);
    const ok = await onSaveAndConnect(h.request);
    setBusy(false);
    if (ok) h.setInput("");
  }

  const recent = useMemo(() => {
    const seen = new Set<string>();
    const out: HistoryEntry[] = [];
    for (const e of history) {
      const k = `${e.host}:${e.port}:${e.profile_id ?? ""}`;
      if (seen.has(k) || e.profile_id == null) continue;
      seen.add(k);
      out.push(e);
      if (out.length >= 5) break;
    }
    return out;
  }, [history]);

  return (
    <div className="w-full h-full overflow-y-auto flex">
      <div className="m-auto w-full max-w-[560px] px-6 py-8 flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-[20px] font-semibold" style={{ color: "var(--foreground)" }}>Connect to a host</h2>
          <p className="text-[13px]" style={{ color: "var(--muted-fg)" }}>
            Type a hostname, <span className="font-mono">user@host</span> or <span className="font-mono">host:port</span>.
          </p>
        </div>

        <div
          className="h-12 flex items-center gap-2.5 px-3.5 rounded-xl"
          style={{
            background: "var(--card)",
            border: `1px solid ${h.invalid ? "var(--destructive)" : "color-mix(in srgb, var(--accent) 60%, var(--border))"}`,
            boxShadow: "0 0 0 3px color-mix(in srgb, var(--accent) 14%, transparent)",
          }}
        >
          <label htmlFor="host-launcher-input" className="sr-only">Host</label>
          <input
            id="host-launcher-input"
            ref={inputRef}
            value={h.input}
            onChange={(e) => h.setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              if (e.metaKey || e.ctrlKey) void saveAndConnect();
              else quick();
            }}
            placeholder="db-02.internal"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            className="flex-1 min-w-0 bg-transparent outline-none font-mono text-[15px]"
            style={{ color: "var(--foreground)" }}
          />
          <ReachBadge reach={h.reach} invalid={h.invalid} />
        </div>

        <div className="grid grid-cols-3 gap-2.5">
          <ActionButton
            primary
            disabled={!canConnect}
            onClick={quick}
            icon={<Zap className="h-[15px] w-[15px]" />}
            title="Quick connect"
            hint="↵ · don’t save"
          />
          <ActionButton
            disabled={!canConnect || h.manual}
            onClick={() => void saveAndConnect()}
            icon={busy ? <Loader2 className="h-[15px] w-[15px] animate-spin" /> : <Bookmark className="h-[15px] w-[15px]" />}
            title="Save & connect"
            hint={h.manual ? "Pick a profile to save" : `${MOD_KEY}↵ · adds to Saved`}
          />
          <ActionButton
            disabled={!h.parsed}
            onClick={() => h.parsed && onMoreOptions({ host: h.parsed.host, port: h.parsed.port })}
            icon={<SlidersHorizontal className="h-[15px] w-[15px]" />}
            title="More options…"
            hint="Jump host, tags, folder"
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted-fg)" }}>Profile</span>
          <ProfileChips
            profiles={profiles}
            selected={h.choice}
            suggestedId={h.parsed && !h.pickedProfile ? h.suggestedProfileId : null}
            onPick={(c) => { h.pickProfile(c); inputRef.current?.focus(); }}
            onNewProfile={onNewProfile}
          />
          {h.needsManualUser && (
            <ManualUserField value={h.manualUser} onChange={h.setManualUser} onEnter={quick} />
          )}
          {h.manual && (
            <p className="text-[12px]" style={{ color: "var(--muted-fg)" }}>
              ssh will ask for the password in the terminal. Nothing is saved.
            </p>
          )}
          {h.userMismatch && h.parsed?.user && (
            <p className="text-[12px]" style={{ color: "var(--muted-fg)" }}>
              No profile uses <span className="font-mono">{h.parsed.user}</span> — ssh will log in as the selected profile’s user.
            </p>
          )}
        </div>

        {recent.length > 0 && (
          <div className="flex flex-col pt-3.5 border-t" style={{ borderColor: "var(--border)" }}>
            <span className="text-[11px] font-semibold uppercase tracking-wide pb-1.5" style={{ color: "var(--muted-fg)" }}>Recent</span>
            {recent.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => onQuickConnect({ host: e.host, port: e.port, profileId: e.profile_id! })}
                className="flex items-center justify-between gap-3 py-1.5 px-2 -mx-2 rounded-md text-left transition-colors hover:bg-[color-mix(in_srgb,var(--foreground)_6%,transparent)]"
                title={`Connect to ${e.host}`}
              >
                <span className="font-mono text-[13px] truncate" style={{ color: "var(--foreground)" }}>
                  {e.host}{e.port && e.port !== 22 ? `:${e.port}` : ""}
                </span>
                <span className="text-[12px] shrink-0" style={{ color: "var(--muted-fg)" }}>
                  {profiles.find((p) => p.id === e.profile_id)?.name ?? e.username ?? ""}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function authLabel(t: Profile["auth_type"]) {
  return t === "password" ? "password" : "key";
}

export function ManualUserField({ value, onChange, onEnter, compact = false }: {
  value: string;
  onChange: (v: string) => void;
  onEnter: () => void;
  compact?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={compact ? "manual-user-compact" : "manual-user"} className="text-[12px] shrink-0" style={{ color: "var(--muted-fg)" }}>
        Username
      </label>
      <input
        id={compact ? "manual-user-compact" : "manual-user"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onEnter(); } }}
        placeholder="optional — defaults to your Mac username"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        className={`flex-1 min-w-0 rounded-lg px-2.5 font-mono outline-none ${compact ? "h-7 text-[12px]" : "h-8 text-[13px]"}`}
        style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--foreground)" }}
      />
    </div>
  );
}

export function ProfileChips({ profiles, selected: selectedChoice, suggestedId, onPick, onNewProfile, compact = false }: {
  profiles: Profile[];
  selected: ProfileChoice;
  suggestedId: number | null;
  onPick: (choice: ProfileChoice) => void;
  onNewProfile: () => void;
  compact?: boolean;
}) {
  const h = compact ? "h-7 px-2.5 text-[12px]" : "h-8 px-3 text-[12.5px]";
  const manualSelected = selectedChoice === "manual";
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Profile">
      <button
        type="button"
        role="radio"
        aria-checked={manualSelected}
        onClick={() => onPick("manual")}
        className={`${h} rounded-lg inline-flex items-center gap-1.5 font-medium transition-colors`}
        style={{
          color: "var(--foreground)",
          background: manualSelected ? "color-mix(in srgb, var(--foreground) 10%, transparent)" : "var(--card)",
          border: `1px solid ${manualSelected ? "color-mix(in srgb, var(--foreground) 45%, transparent)" : "var(--border)"}`,
        }}
        title="No profile — type the username and password yourself"
      >
        <KeyRound className="h-3.5 w-3.5" style={{ color: "var(--muted-fg)" }} />
        Enter credentials
      </button>
      {profiles.map((p) => {
        const selected = p.id === selectedChoice;
        const color = COLOR_HEX[p.color as ProfileColor] ?? COLOR_HEX.cyan;
        return (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onPick(p.id)}
            className={`${h} rounded-lg inline-flex items-center gap-1.5 font-medium transition-colors`}
            style={{
              color: "var(--foreground)",
              background: selected ? `${color}1f` : "var(--card)",
              border: `1px solid ${selected ? `${color}99` : "var(--border)"}`,
            }}
            title={`${p.username || "(no user)"} · ${authLabel(p.auth_type)}`}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: color }} />
            {p.name}
            <span style={{ color: "var(--muted-fg)" }}>· {authLabel(p.auth_type)}</span>
            {p.id === suggestedId && (
              <span className="text-[10px] font-semibold" style={{ color }}>Suggested</span>
            )}
          </button>
        );
      })}
      <button
        type="button"
        onClick={onNewProfile}
        className={`${h} rounded-lg inline-flex items-center gap-1 font-medium`}
        style={{ color: "var(--muted-fg)", border: "1px dashed var(--border)" }}
      >
        <Plus className="h-3.5 w-3.5" /> New profile
      </button>
    </div>
  );
}

export function ReachBadge({ reach, invalid = false }: { reach: Reach; invalid?: boolean }) {
  if (invalid) {
    return (
      <span className="shrink-0 inline-flex items-center gap-1.5 text-[12px]" style={{ color: "var(--muted-fg)" }} aria-live="polite">
        <span className="h-2 w-2 rounded-full" style={{ background: "#f85149" }} />
        Not a valid host
      </span>
    );
  }
  if (reach.state === "idle") return null;
  const color = reach.state === "ok" ? "#34d399" : reach.state === "fail" ? "#f85149" : "var(--muted-fg)";
  const text = reach.state === "ok" ? "Reachable" : reach.state === "checking" ? "Checking…" : "Unreachable";
  return (
    <span
      className="shrink-0 inline-flex items-center gap-1.5 text-[12px]"
      style={{ color: "var(--muted-fg)" }}
      title={reach.state === "fail" ? reach.error : undefined}
      aria-live="polite"
    >
      {reach.state === "checking"
        ? <Loader2 className="h-3 w-3 animate-spin" />
        : <span className="h-2 w-2 rounded-full" style={{ background: color }} />}
      {text}
    </span>
  );
}

function ActionButton({ primary = false, disabled, onClick, icon, title, hint }: {
  primary?: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="h-[76px] p-3 rounded-xl flex flex-col justify-between text-left transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
      style={{
        color: "var(--foreground)",
        background: primary ? "color-mix(in srgb, var(--accent) 14%, transparent)" : "var(--card)",
        border: `1px solid ${primary ? "color-mix(in srgb, var(--accent) 60%, transparent)" : "var(--border)"}`,
      }}
    >
      <span className="inline-flex items-center gap-2 text-[13px] font-semibold">
        <span style={{ color: primary ? "var(--accent)" : "var(--muted-fg)" }}>{icon}</span>
        {title}
      </span>
      <span className="text-[11.5px]" style={{ color: "var(--muted-fg)" }}>{hint}</span>
    </button>
  );
}
