"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Key, Lock, ShieldCheck, Star, Check } from "lucide-react";
import { COLOR_HEX, PROFILE_COLORS, type ProfileColor } from "@/lib/profile-colors";
import type { Profile } from "@/lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (profile?: Profile) => void;
  profile?: Profile | null;
}

export default function ProfileDialog({ open, onClose, onSave, profile }: Props) {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [authType, setAuthType] = useState<"password" | "key" | "key_with_passphrase">("key");
  const [password, setPassword] = useState("");
  const [keyPath, setKeyPath] = useState("");
  const [port, setPort] = useState("22");
  const [color, setColor] = useState<ProfileColor>("cyan");
  const [isDefault, setIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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
    } else {
      setName("");
      setUsername("");
      setAuthType("key");
      setPassword("");
      setKeyPath("~/.ssh/id_rsa");
      setPort("22");
      setColor("cyan");
      setIsDefault(false);
    }
    setError("");
  }, [profile, open]);

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
      <DialogContent className="sm:max-w-md" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
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
            <Label className="text-xs uppercase tracking-wide" style={{ color: "var(--muted-foreground)" }}>Profile name</Label>
            <Input placeholder="e.g. Personal SSH Key, Work Server" value={name} onChange={e => setName(e.target.value)} autoFocus />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide" style={{ color: "var(--muted-foreground)" }}>Username</Label>
              <Input placeholder="root" value={username} onChange={e => setUsername(e.target.value)} className="font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide" style={{ color: "var(--muted-foreground)" }}>Default port</Label>
              <Input type="number" placeholder="22" value={port} onChange={e => setPort(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide" style={{ color: "var(--muted-foreground)" }}>Authentication</Label>
            <Select value={authType} onValueChange={(v) => setAuthType(v as typeof authType)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="key">
                  <span className="flex items-center gap-2"><Key className="h-3.5 w-3.5" style={{ color: colorHex }} />SSH Key</span>
                </SelectItem>
                <SelectItem value="key_with_passphrase">
                  <span className="flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5" style={{ color: colorHex }} />SSH Key + Passphrase</span>
                </SelectItem>
                <SelectItem value="password">
                  <span className="flex items-center gap-2"><Lock className="h-3.5 w-3.5" style={{ color: "#fbbf24" }} />Password</span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isKey && (
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide" style={{ color: "var(--muted-foreground)" }}>Key path</Label>
              <Input placeholder="~/.ssh/id_rsa" value={keyPath} onChange={e => setKeyPath(e.target.value)} className="font-mono text-sm" />
            </div>
          )}

          {authType === "password" && (
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide" style={{ color: "var(--muted-foreground)" }}>Password</Label>
              <Input type="password" placeholder="Stored locally on this machine" value={password} onChange={e => setPassword(e.target.value)} />
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide" style={{ color: "var(--muted-foreground)" }}>Color</Label>
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
                    <div className="absolute inset-0 rounded-lg ring-2 ring-offset-2 ring-offset-card" style={{ '--tw-ring-color': COLOR_HEX[c] } as React.CSSProperties} />
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
              <p className="text-sm font-medium flex items-center gap-1.5" style={{ color: "var(--foreground)" }}>
                <Star className="h-3.5 w-3.5" style={{ color: isDefault ? colorHex : "var(--muted-foreground)" }} fill={isDefault ? colorHex : "none"} />
                Set as default profile
              </p>
              <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>Auto-selected when creating new sessions</p>
            </div>
          </button>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
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
