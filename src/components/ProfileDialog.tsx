"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Key, Lock, ShieldCheck, Star, Check, AlertCircle, ChevronDown, ChevronRight, Eye, EyeOff } from "lucide-react";
import { COLOR_HEX, PROFILE_COLORS, type ProfileColor } from "@/lib/profile-colors";
import type { Profile } from "@/lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (profile?: Profile) => void;
  profile?: Profile | null;
  backLabel?: string; // when shown from another dialog, e.g. "Back to session"
}

export default function ProfileDialog({ open, onClose, onSave, profile, backLabel }: Props) {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [authType, setAuthType] = useState<"password" | "key" | "key_with_passphrase">("key");
  const [password, setPassword] = useState("");
  const [keyPath, setKeyPath] = useState("");
  const [port, setPort] = useState("22");
  const [color, setColor] = useState<ProfileColor>("cyan");
  const [isDefault, setIsDefault] = useState(false);
  const [agentForwarding, setAgentForwarding] = useState(false);
  const [compression, setCompression] = useState(false);
  const [serverAliveInterval, setServerAliveInterval] = useState("0");
  const [extraArgs, setExtraArgs] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [keyValid, setKeyValid] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [secretFetched, setSecretFetched] = useState(false);

  useEffect(() => {
    if (profile) {
      setName(profile.name);
      setUsername(profile.username);
      setAuthType(profile.auth_type);
      setPassword(profile.password || "");
      setKeyPath(profile.key_path || "");
      setPort(String(profile.port));
      setColor((profile.color as ProfileColor) || "cyan");
      setIsDefault(!!profile.is_default);
      setAgentForwarding(!!profile.agent_forwarding);
      setCompression(!!profile.compression);
      setServerAliveInterval(String(profile.server_alive_interval || 0));
      setExtraArgs(profile.extra_args || "");
    } else {
      setName("");
      setUsername("");
      setAuthType("key");
      setPassword("");
      setKeyPath("~/.ssh/id_rsa");
      setPort("22");
      setColor("cyan");
      setIsDefault(false);
      setAgentForwarding(false);
      setCompression(false);
      setServerAliveInterval("0");
      setExtraArgs("");
    }
    setAdvancedOpen(false);
    setError("");
    setShowSecret(false);
    setSecretFetched(false);
  }, [profile, open]);

  // Lazily fetch the stored secret (password or passphrase) from server when user clicks the reveal eye.
  async function revealSecret() {
    if (!profile) {
      setShowSecret(s => !s);
      return;
    }
    if (showSecret) {
      setShowSecret(false);
      return;
    }
    // If we don't yet have the value loaded from the server, fetch it
    if (!secretFetched && !password) {
      try {
        const res = await fetch(`/api/profiles/${profile.id}/secret`);
        if (res.ok) {
          const data = await res.json();
          if (data.password) setPassword(data.password);
        }
      } catch {/* ignore */}
      setSecretFetched(true);
    }
    setShowSecret(true);
  }

  // Validate key file when path changes (debounced)
  useEffect(() => {
    if (authType === "password" || !keyPath.trim()) {
      setKeyValid(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/validate-key", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: keyPath }),
        });
        const data = await res.json();
        setKeyValid(data.exists);
      } catch {
        setKeyValid(null);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [keyPath, authType]);

  async function handleSave() {
    setError("");
    if (!name.trim() || !username.trim()) {
      setError("Name and username are required.");
      return;
    }
    setSaving(true);
    const body = {
      name: name.trim(),
      username: username.trim(),
      auth_type: authType,
      password,
      key_path: keyPath,
      port: parseInt(port) || 22,
      color,
      is_default: isDefault ? 1 : 0,
      agent_forwarding: agentForwarding ? 1 : 0,
      compression: compression ? 1 : 0,
      server_alive_interval: parseInt(serverAliveInterval) || 0,
      extra_args: extraArgs.trim() || null,
    };
    const res = await fetch(profile ? `/api/profiles/${profile.id}` : "/api/profiles", {
      method: profile ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Failed to save.");
      return;
    }
    const saved: Profile = await res.json();
    onSave(saved);
    onClose();
  }

  const isKey = authType === "key" || authType === "key_with_passphrase";
  const colorHex = COLOR_HEX[color];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ background: colorHex }} />
            {profile ? "Edit profile" : "New credential profile"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {error && (
            <p className="text-xs text-destructive bg-destructive/10 px-3 py-2 rounded-lg">{error}</p>
          )}

          <div className="space-y-1.5">
            <Label className="text-[12.5px] font-semibold" style={{ color: "var(--muted-fg)" }}>Profile name</Label>
            <Input placeholder="e.g. Personal SSH Key" value={name} onChange={e => setName(e.target.value)} autoFocus />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[12.5px] font-semibold" style={{ color: "var(--muted-fg)" }}>Username</Label>
              <Input placeholder="root" value={username} onChange={e => setUsername(e.target.value)} className="font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12.5px] font-semibold" style={{ color: "var(--muted-fg)" }}>Default port</Label>
              <Input type="number" placeholder="22" value={port} onChange={e => setPort(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[12.5px] font-semibold" style={{ color: "var(--muted-fg)" }}>Authentication</Label>
            <Select value={authType} onValueChange={(v) => setAuthType(v as typeof authType)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="key"><span className="flex items-center gap-2"><Key className="h-3.5 w-3.5" style={{ color: colorHex }} />SSH Key</span></SelectItem>
                <SelectItem value="key_with_passphrase"><span className="flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5" style={{ color: colorHex }} />SSH Key + Passphrase</span></SelectItem>
                <SelectItem value="password"><span className="flex items-center gap-2"><Lock className="h-3.5 w-3.5" style={{ color: "#fbbf24" }} />Password</span></SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isKey && (
            <div className="space-y-1.5">
              <Label className="text-[12.5px] font-semibold" style={{ color: "var(--muted-fg)" }}>Key path</Label>
              <Input placeholder="~/.ssh/id_rsa" value={keyPath} onChange={e => setKeyPath(e.target.value)} className="font-mono text-sm" />
              <div className="flex items-center justify-between">
                {keyValid === false && (
                  <p className="text-[12px] flex items-center gap-1" style={{ color: "#fbbf24" }}>
                    <AlertCircle className="h-3 w-3" /> Key file not found at this path
                  </p>
                )}
                {keyValid === true && (
                  <p className="text-[12px] flex items-center gap-1" style={{ color: colorHex }}>
                    <Check className="h-3 w-3" /> Key file found
                  </p>
                )}
                {keyValid === null && <span />}
                {keyPath && (
                  <button
                    type="button"
                    onClick={() => {
                      // Use file:// URL — Electron's setWindowOpenHandler routes externals to the OS
                      navigator.clipboard.writeText(keyPath);
                    }}
                    className="text-[11.5px] underline-offset-2 hover:underline"
                    style={{ color: "var(--muted-fg)" }}
                    title="Copy path"
                  >
                    Copy path
                  </button>
                )}
              </div>
            </div>
          )}

          {(authType === "password" || authType === "key_with_passphrase") && (
            <div className="space-y-1.5">
              <Label className="text-[12.5px] font-semibold" style={{ color: "var(--muted-fg)" }}>
                {authType === "password" ? "Password" : "Passphrase"}
              </Label>
              <div className="relative">
                <Input
                  type={showSecret ? "text" : "password"}
                  placeholder={profile && !password ? "•••••••• (click eye to reveal)" : "Stored encrypted in OS keychain"}
                  value={password}
                  onChange={e => { setPassword(e.target.value); setSecretFetched(true); }}
                  className="pr-9 font-mono"
                />
                <button
                  type="button"
                  onClick={revealSecret}
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 flex items-center justify-center rounded-md transition-colors"
                  style={{ color: "var(--muted-fg)" }}
                  title={showSecret ? "Hide" : "Show"}
                  aria-label={showSecret ? "Hide" : "Show"}
                >
                  {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
              <p className="text-[11px] flex items-center gap-1" style={{ color: "var(--subtle-fg)" }}>
                <ShieldCheck className="h-3 w-3" /> Stored encrypted in macOS Keychain
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-[12.5px] font-semibold" style={{ color: "var(--muted-fg)" }}>Color</Label>
            <div className="flex gap-1.5">
              {PROFILE_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className="relative flex h-8 w-8 items-center justify-center rounded-lg transition-transform hover:scale-110"
                  style={{ background: `${COLOR_HEX[c]}25`, border: `1px solid ${COLOR_HEX[c]}50` }}
                  aria-label={c}
                >
                  <div className="h-3 w-3 rounded-full" style={{ background: COLOR_HEX[c] }} />
                  {color === c && (
                    <div className="absolute inset-0 rounded-lg ring-2 ring-offset-2" style={{ '--tw-ring-color': COLOR_HEX[c], '--tw-ring-offset-color': 'var(--card)' } as React.CSSProperties} />
                  )}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsDefault(!isDefault)}
            className="flex items-center gap-3 w-full rounded-lg px-3 py-2 transition-colors"
            style={{ background: isDefault ? `${colorHex}10` : "transparent", border: `1px solid ${isDefault ? colorHex + "40" : "var(--border)"}` }}
          >
            <div className="flex h-5 w-5 items-center justify-center rounded transition-colors" style={{ background: isDefault ? colorHex : "transparent", border: `1.5px solid ${isDefault ? colorHex : "var(--border)"}` }}>
              {isDefault && <Check className="h-3.5 w-3.5" style={{ color: "var(--accent-foreground)" }} strokeWidth={3} />}
            </div>
            <div className="flex-1 text-left">
              <p className="text-[14px] font-semibold flex items-center gap-1.5" style={{ color: "var(--foreground)" }}>
                <Star className="h-3.5 w-3.5" style={{ color: isDefault ? colorHex : "var(--subtle-fg)" }} fill={isDefault ? colorHex : "none"} />
                Set as default profile
              </p>
              <p className="text-[12px] mt-0.5" style={{ color: "var(--muted-fg)" }}>Auto-selected for new sessions</p>
            </div>
          </button>

          {/* Advanced SSH options */}
          <button
            type="button"
            onClick={() => setAdvancedOpen(!advancedOpen)}
            className="flex items-center gap-1 text-[12.5px] font-semibold w-full"
            style={{ color: "var(--muted-fg)" }}
          >
            {advancedOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            Advanced SSH options
          </button>

          {advancedOpen && (
            <div className="space-y-3 pl-4 border-l-2" style={{ borderColor: "var(--border)" }}>
              <Toggle
                label="Agent forwarding (-A)"
                description="Forward your SSH agent to the remote host"
                checked={agentForwarding}
                onChange={setAgentForwarding}
                colorHex={colorHex}
              />
              <Toggle
                label="Compression (-C)"
                description="Useful on slow connections"
                checked={compression}
                onChange={setCompression}
                colorHex={colorHex}
              />
              <div className="space-y-1.5">
                <Label className="text-[12.5px] font-semibold" style={{ color: "var(--muted-fg)" }}>Keepalive interval (seconds)</Label>
                <Input type="number" min={0} placeholder="0 = off" value={serverAliveInterval} onChange={e => setServerAliveInterval(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[12.5px] font-semibold" style={{ color: "var(--muted-fg)" }}>Extra arguments</Label>
                <Input placeholder="-o StrictHostKeyChecking=no" value={extraArgs} onChange={e => setExtraArgs(e.target.value)} className="font-mono text-sm" />
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>{backLabel || "Cancel"}</Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            style={{ background: colorHex, color: "var(--accent-foreground)", border: "none" }}
          >
            {saving ? "Saving…" : profile ? "Save changes" : "Create profile"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Toggle({ label, description, checked, onChange, colorHex }: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  colorHex: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center gap-3 w-full rounded-lg px-2 py-1.5 transition-colors text-left"
    >
      <div className="flex h-4 w-4 items-center justify-center rounded shrink-0 transition-colors" style={{ background: checked ? colorHex : "transparent", border: `1.5px solid ${checked ? colorHex : "var(--border)"}` }}>
        {checked && <Check className="h-3 w-3" style={{ color: "var(--accent-foreground)" }} strokeWidth={3} />}
      </div>
      <div className="flex-1">
        <p className="text-[13px] font-medium" style={{ color: "var(--foreground)" }}>{label}</p>
        <p className="text-[11.5px]" style={{ color: "var(--subtle-fg)" }}>{description}</p>
      </div>
    </button>
  );
}
