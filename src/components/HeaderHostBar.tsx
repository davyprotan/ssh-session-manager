"use client";

// Always-visible host field in the app header. Type a host and the connect
// options appear straight away underneath — no button to click first:
//   ↵       Quick connect (suggested / chosen profile, not saved)
//   ⌘/Ctrl+↵ Save & connect
//   Esc     clear
// The profile row lets you switch profile without leaving the keyboard flow.

import { useEffect, useRef, useState } from "react";
import { Server, Zap, Bookmark, SlidersHorizontal, Loader2 } from "lucide-react";
import { useHostLaunch, type LaunchRequest } from "@/lib/use-host-launch";
import { ProfileChips, ReachBadge, ManualUserField, MOD_KEY } from "./HostLauncher";
import { NEW_TAB_SHORTCUT } from "@/lib/shortcuts";
import type { Profile, Session } from "@/lib/types";

interface Props {
  profiles: Profile[];
  sessions: Session[];
  /** Changes whenever the field should take keyboard focus (⌘T). */
  focusRequest?: number;
  onQuickConnect: (req: LaunchRequest) => void;
  onSaveAndConnect: (req: LaunchRequest) => Promise<boolean>;
  onMoreOptions: (prefill: { host: string; port?: number }) => void;
  onNewProfile: () => void;
}

export default function HeaderHostBar({
  profiles, sessions, focusRequest = 0,
  onQuickConnect, onSaveAndConnect, onMoreOptions, onNewProfile,
}: Props) {
  const h = useHostLaunch(profiles, sessions);
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusRequest > 0) { inputRef.current?.focus(); inputRef.current?.select(); }
  }, [focusRequest]);

  const open = focused && h.input.trim().length > 0;
  const canConnect = !!h.request && !busy;

  function done() {
    h.setInput("");
    h.setManualUser("");
    (document.activeElement as HTMLElement | null)?.blur();
  }

  function quick() {
    if (!canConnect || !h.request) return;
    onQuickConnect(h.request);
    done();
  }

  async function saveAndConnect() {
    if (!canConnect || !h.request || h.manual) return;
    setBusy(true);
    const ok = await onSaveAndConnect(h.request);
    setBusy(false);
    if (ok) done();
  }

  function moreOptions() {
    if (!h.parsed) return;
    onMoreOptions({ host: h.parsed.host, port: h.parsed.port });
    done();
  }

  return (
    <div
      className="relative flex-[0_1_340px] min-w-[130px]"
      // Track focus for the whole widget (host field + username field), so
      // moving between them keeps the options open.
      onFocus={() => setFocused(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false); }}
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); done(); } }}
    >
      <div
        className="h-8 flex items-center gap-2 pl-2.5 pr-1.5 rounded-lg transition-colors"
        style={{
          background: "var(--muted)",
          border: `1px solid ${h.invalid ? "var(--destructive)" : focused ? "color-mix(in srgb, var(--accent) 60%, var(--border))" : "var(--border)"}`,
          boxShadow: focused ? "0 0 0 3px color-mix(in srgb, var(--accent) 14%, transparent)" : "none",
        }}
      >
        <Server className="h-3.5 w-3.5 shrink-0" style={{ color: focused ? "var(--accent)" : "var(--muted-fg)" }} />
        <label htmlFor="header-host-input" className="sr-only">Connect to host</label>
        <input
          id="header-host-input"
          ref={inputRef}
          value={h.input}
          onChange={(e) => h.setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (e.metaKey || e.ctrlKey) void saveAndConnect();
            else quick();
          }}
          placeholder="Connect to host…"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          className="flex-1 min-w-0 bg-transparent outline-none text-[13px] font-mono placeholder:font-sans"
          style={{ color: "var(--foreground)" }}
        />
        {!focused && !h.input && (
          <kbd className="text-[10.5px] px-1.5 py-0.5 rounded border font-sans" style={{ color: "var(--muted-fg)", borderColor: "var(--border)" }}>
            {NEW_TAB_SHORTCUT}
          </kbd>
        )}
      </div>

      {open && (
        <div
          // Keep focus in the input while clicking options, so the panel
          // doesn't close on mousedown before the click lands.
          onMouseDown={(e) => e.preventDefault()}
          className="absolute right-0 top-[calc(100%+6px)] z-50 rounded-xl p-2 flex flex-col gap-0.5 w-[min(400px,calc(100vw-24px))]"
          style={{ background: "var(--popover)", border: "1px solid var(--border)", boxShadow: "0 16px 40px rgba(0,0,0,0.45)" }}
        >
          <div className="flex items-center justify-between gap-2 px-2.5 pt-1 pb-2 text-[12px]" style={{ color: "var(--muted-fg)" }}>
            <span className="font-mono truncate" style={{ color: "var(--foreground)" }}>
              {h.parsed ? `${h.parsed.host}${h.parsed.port ? `:${h.parsed.port}` : ""}` : h.input.trim()}
            </span>
            <ReachBadge reach={h.reach} invalid={h.invalid} />
          </div>

          <Row
            primary
            disabled={!canConnect}
            onClick={quick}
            icon={<Zap className="h-4 w-4" />}
            title="Quick connect"
            hint="Open now, don’t save"
            kbd="↵"
          />
          <Row
            disabled={!canConnect || h.manual}
            onClick={() => void saveAndConnect()}
            icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bookmark className="h-4 w-4" />}
            title="Save & connect"
            hint={h.manual ? "Pick a profile below to save" : "Add to Saved, then open"}
            kbd={`${MOD_KEY}↵`}
          />
          <Row
            disabled={!h.parsed}
            onClick={moreOptions}
            icon={<SlidersHorizontal className="h-4 w-4" />}
            title="More options…"
            hint="Jump host, tags, folder"
          />

          <div className="h-px my-1.5 mx-1" style={{ background: "var(--border)" }} />
          <div className="px-2.5 pb-1.5 text-[10.5px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted-fg)" }}>
            Connect as
          </div>
          <div className="px-1.5 pb-1.5">
            <ProfileChips
              compact
              profiles={profiles}
              selected={h.choice}
              suggestedId={h.parsed && !h.pickedProfile ? h.suggestedProfileId : null}
              onPick={(c) => h.pickProfile(c)}
              onNewProfile={onNewProfile}
            />
            {h.needsManualUser && (
              // Real focus target, so let mousedown through to it.
              <div className="mt-2" onMouseDown={(e) => e.stopPropagation()}>
                <ManualUserField compact value={h.manualUser} onChange={h.setManualUser} onEnter={quick} />
              </div>
            )}
            {h.manual && (
              <p className="text-[11.5px] mt-2 px-1" style={{ color: "var(--muted-fg)" }}>
                ssh will ask for the password in the terminal.
              </p>
            )}
            {h.userMismatch && h.parsed?.user && (
              <p className="text-[11.5px] mt-2 px-1" style={{ color: "var(--muted-fg)" }}>
                No profile uses <span className="font-mono">{h.parsed.user}</span> — ssh logs in as the selected profile’s user.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ primary = false, disabled, onClick, icon, title, hint, kbd }: {
  primary?: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  hint: string;
  kbd?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex items-center gap-3 px-2.5 py-2 rounded-lg text-left transition-colors disabled:opacity-45 disabled:cursor-not-allowed hover:bg-[color-mix(in_srgb,var(--foreground)_6%,transparent)]"
      style={{
        color: "var(--foreground)",
        background: primary ? "color-mix(in srgb, var(--accent) 12%, transparent)" : undefined,
      }}
    >
      <span style={{ color: primary ? "var(--accent)" : "var(--muted-fg)" }}>{icon}</span>
      <span className="flex-1 min-w-0 flex flex-col">
        <span className="text-[13px] font-semibold">{title}</span>
        <span className="text-[11.5px]" style={{ color: "var(--muted-fg)" }}>{hint}</span>
      </span>
      {kbd && (
        <kbd className="text-[10.5px] px-1.5 py-0.5 rounded border font-sans" style={{ color: "var(--muted-fg)", borderColor: "var(--border)" }}>{kbd}</kbd>
      )}
    </button>
  );
}
