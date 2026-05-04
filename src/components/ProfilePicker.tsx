"use client";

import { Key, Lock, Plus, Check, Star, ShieldCheck } from "lucide-react";
import { COLOR_HEX, type ProfileColor } from "@/lib/profile-colors";
import type { Profile } from "@/lib/types";

interface Props {
  profiles: Profile[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  onNewProfile?: () => void;
  showNoneOption?: boolean;
  compact?: boolean;
}

export default function ProfilePicker({ profiles, selectedId, onSelect, onNewProfile, showNoneOption = false, compact = false }: Props) {
  if (profiles.length === 0) {
    return (
      <button
        type="button"
        onClick={onNewProfile}
        className="w-full flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed py-10 px-4 transition-all"
        style={{ borderColor: "var(--border)" }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "color-mix(in srgb, var(--accent) 50%, transparent)"; (e.currentTarget as HTMLButtonElement).style.background = "color-mix(in srgb, var(--accent) 5%, transparent)"; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: "color-mix(in srgb, var(--accent) 10%, transparent)", color: "var(--accent)" }}>
          <Plus className="h-5 w-5" />
        </div>
        <div className="text-center">
          <p className="font-medium text-sm" style={{ color: "var(--foreground)" }}>Create your first profile</p>
          <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>
            A profile stores your username + SSH key or password
          </p>
        </div>
      </button>
    );
  }

  return (
    <div className={compact ? "grid grid-cols-2 gap-2" : "grid grid-cols-1 gap-2"}>
      {showNoneOption && (
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="group flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-all duration-150 text-left"
          style={{
            background: selectedId === null ? "rgba(255,255,255,0.04)" : "transparent",
            borderColor: selectedId === null ? "rgba(255,255,255,0.15)" : "var(--border)",
          }}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: "rgba(255,255,255,0.05)" }}>
            <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>—</span>
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>No profile</p>
            <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>Use system SSH defaults</p>
          </div>
          {selectedId === null && (
            <Check className="h-4 w-4 shrink-0" style={{ color: "var(--muted-foreground)" }} />
          )}
        </button>
      )}

      {profiles.map(p => {
        const selected = selectedId === p.id;
        const color = COLOR_HEX[p.color as ProfileColor] || COLOR_HEX.cyan;
        const isPassword = p.auth_type === "password";

        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect(p.id)}
            className="group relative flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-all duration-150 text-left"
            style={{
              background: selected ? `${color}10` : "var(--card)",
              borderColor: selected ? `${color}80` : "var(--border)",
              boxShadow: selected ? `0 0 0 1px ${color}40, 0 4px 14px ${color}15` : "none",
            }}
          >
            {/* Color indicator strip */}
            <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r-full" style={{ background: selected ? color : `${color}50` }} />

            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
              style={{ background: `${color}1a`, color }}
            >
              {isPassword ? <Lock className="h-4 w-4" /> : p.auth_type === "key_with_passphrase" ? <ShieldCheck className="h-4 w-4" /> : <Key className="h-4 w-4" />}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-semibold truncate" style={{ color: "var(--foreground)" }}>{p.name}</p>
                {p.is_default ? (
                  <Star className="h-3 w-3 shrink-0 fill-current" style={{ color }} />
                ) : null}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-xs font-mono truncate" style={{ color: "var(--muted-foreground)" }}>{p.username}</span>
                {p.key_path && !compact && (
                  <>
                    <span style={{ color: "rgba(139,148,158,0.4)" }}>·</span>
                    <span className="text-xs font-mono truncate" style={{ color: "rgba(139,148,158,0.6)" }}>{p.key_path}</span>
                  </>
                )}
              </div>
            </div>

            {selected && (
              <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full" style={{ background: color }}>
                <Check className="h-3 w-3" style={{ color: "var(--accent-foreground)" }} strokeWidth={3} />
              </div>
            )}
          </button>
        );
      })}

      {onNewProfile && (
        <button
          type="button"
          onClick={onNewProfile}
          className="group flex items-center gap-3 rounded-xl border border-dashed px-3 py-2.5 transition-all duration-150 text-left"
          style={{ borderColor: "var(--border)" }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "color-mix(in srgb, var(--accent) 40%, transparent)"; (e.currentTarget as HTMLButtonElement).style.background = "color-mix(in srgb, var(--accent) 5%, transparent)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors" style={{ background: "rgba(255,255,255,0.03)" }}>
            <Plus className="h-4 w-4 transition-colors" style={{ color: "var(--muted-foreground)" }} />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium transition-colors" style={{ color: "var(--foreground)" }}>
              New profile
            </p>
            <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>Add another set of credentials</p>
          </div>
        </button>
      )}
    </div>
  );
}
