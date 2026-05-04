"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Zap, Terminal } from "lucide-react";
import ProfilePicker from "./ProfilePicker";
import ProfileDialog from "./ProfileDialog";
import { toast } from "sonner";
import type { Profile } from "@/lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  profiles: Profile[];
  onProfilesChanged: () => void;
}

export default function QuickConnectDialog({ open, onClose, profiles, onProfilesChanged }: Props) {
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [profileId, setProfileId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setHost("");
      setPort("");
      const def = profiles.find(p => p.is_default) || profiles[0];
      setProfileId(def?.id ?? null);
    }
  }, [open, profiles]);

  async function handleConnect() {
    if (!host.trim() || !profileId) return;
    setConnecting(true);
    const res = await fetch("/api/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        host: host.trim(),
        profile_id: profileId,
        port: port ? parseInt(port) : undefined,
      }),
    });
    setConnecting(false);
    if (res.ok) {
      const data = await res.json();
      toast.success(`Connecting to ${host}`, { description: data.command });
      onClose();
    } else {
      toast.error("Failed to connect");
    }
  }

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
              Connect to any host without saving it. Pick which credentials to use.
            </DialogDescription>
          </DialogHeader>

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
                  onKeyDown={e => { if (e.key === "Enter" && host.trim() && profileId) handleConnect(); }}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[12.5px] font-semibold" style={{ color: "var(--muted-fg)" }}>Port</Label>
                <Input type="number" placeholder="22" value={port} onChange={e => setPort(e.target.value)} />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-[12.5px] font-semibold" style={{ color: "var(--muted-fg)" }}>Use credentials from</Label>
              <ProfilePicker
                profiles={profiles}
                selectedId={profileId}
                onSelect={setProfileId}
                onNewProfile={() => setProfileDialogOpen(true)}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              onClick={handleConnect}
              disabled={connecting || !host.trim() || !profileId}
              className="gap-1.5"
              style={{ background: "var(--accent)", color: "var(--accent-foreground)", border: "none" }}
            >
              <Terminal className="h-3.5 w-3.5" />
              {connecting ? "Opening…" : "Connect"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ProfileDialog
        open={profileDialogOpen}
        onClose={() => setProfileDialogOpen(false)}
        onSave={(saved) => {
          onProfilesChanged();
          if (saved?.id) setProfileId(saved.id);
        }}
      />
    </>
  );
}
