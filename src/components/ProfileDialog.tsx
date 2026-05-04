"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Key, Lock, ShieldCheck } from "lucide-react";
import type { Profile } from "@/lib/db";

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: () => void;
  profile?: Profile | null;
}

export default function ProfileDialog({ open, onClose, onSave, profile }: Props) {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [authType, setAuthType] = useState<"password" | "key" | "key_with_passphrase">("key");
  const [password, setPassword] = useState("");
  const [keyPath, setKeyPath] = useState("");
  const [port, setPort] = useState("22");
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
    } else {
      setName("");
      setUsername("");
      setAuthType("key");
      setPassword("");
      setKeyPath("~/.ssh/id_rsa");
      setPort("22");
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
    const body = { name: name.trim(), username: username.trim(), auth_type: authType, password, key_path: keyPath, port: parseInt(port) || 22 };
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
    onSave();
    onClose();
  }

  const isKey = authType === "key" || authType === "key_with_passphrase";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md border-border/60">
        <DialogHeader>
          <DialogTitle>{profile ? "Edit profile" : "New credential profile"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {error && (
            <p className="text-xs text-destructive bg-destructive/10 px-3 py-2 rounded-lg">{error}</p>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">Profile name</Label>
            <Input placeholder="e.g. Personal SSH Key, Work Server" value={name} onChange={e => setName(e.target.value)} autoFocus />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">Username</Label>
              <Input placeholder="root" value={username} onChange={e => setUsername(e.target.value)} className="font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">Default port</Label>
              <Input type="number" placeholder="22" value={port} onChange={e => setPort(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">Authentication</Label>
            <Select value={authType} onValueChange={(v) => setAuthType(v as typeof authType)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="key">
                  <span className="flex items-center gap-2"><Key className="h-3.5 w-3.5 text-primary" />SSH Key</span>
                </SelectItem>
                <SelectItem value="key_with_passphrase">
                  <span className="flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5 text-primary" />SSH Key + Passphrase</span>
                </SelectItem>
                <SelectItem value="password">
                  <span className="flex items-center gap-2"><Lock className="h-3.5 w-3.5 text-amber-400" />Password</span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isKey && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">Key path</Label>
              <Input placeholder="~/.ssh/id_rsa" value={keyPath} onChange={e => setKeyPath(e.target.value)} className="font-mono text-sm" />
            </div>
          )}

          {authType === "password" && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">Password</Label>
              <Input type="password" placeholder="Stored locally on this machine" value={password} onChange={e => setPassword(e.target.value)} />
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} className="border-border/60">Cancel</Button>
          <Button onClick={handleSave} disabled={saving} className="bg-primary/90 hover:bg-primary shadow-sm shadow-primary/20">
            {saving ? "Saving…" : profile ? "Save changes" : "Create profile"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
