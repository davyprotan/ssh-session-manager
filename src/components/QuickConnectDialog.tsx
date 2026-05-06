"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Zap, Terminal, Check, BookmarkPlus, KeyRound } from "lucide-react";
import ProfilePicker from "./ProfilePicker";
import ProfileDialog from "./ProfileDialog";
import SetupPasswordlessDialog from "./SetupPasswordlessDialog";
import { toast } from "sonner";
import type { Profile } from "@/lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  profiles: Profile[];
  onProfilesChanged: () => void;
  onSessionSaved?: (saved?: { id: number; name: string; host: string; profile_auth_type?: string | null }) => void;
}

export default function QuickConnectDialog({ open, onClose, profiles, onProfilesChanged, onSessionSaved }: Props) {
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [profileId, setProfileId] = useState<number | null>(null);
  const [saveSession, setSaveSession] = useState(false);
  const [sessionName, setSessionName] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [passwordlessOpen, setPasswordlessOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setHost("");
      setPort("");
      setSaveSession(false);
      setSessionName("");
      const def = profiles.find(p => p.is_default) || profiles[0];
      setProfileId(def?.id ?? null);
    }
  }, [open, profiles]);

  // Default the session name to the host as the user types
  useEffect(() => {
    if (saveSession && host && !sessionName) setSessionName(host);
  }, [host, saveSession, sessionName]);

  async function handleConnect() {
    if (!host.trim() || !profileId) return;
    setConnecting(true);

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
          profile_id: profileId,
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

    // Use the saved session_id if we just created it, else quick-connect via host+profile
    const connectBody = savedSessionId
      ? { session_id: savedSessionId }
      : {
          host: host.trim(),
          profile_id: profileId,
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
  }

  const canSubmit = !!host.trim() && !!profileId && !connecting;
  const selectedProfile = profiles.find(p => p.id === profileId) || null;
  const isPasswordAuth = selectedProfile?.auth_type === "password";

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
              Connect to any host. Optionally save it as a session.
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
                  onKeyDown={e => { if (e.key === "Enter" && canSubmit) handleConnect(); }}
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

            {/* Save as session toggle */}
            <button
              type="button"
              onClick={() => setSaveSession(s => !s)}
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
                  placeholder={host || "My Server"}
                  value={sessionName}
                  onChange={e => setSessionName(e.target.value)}
                />
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 flex-wrap">
            {isPasswordAuth && host.trim() && (
              <Button
                variant="outline"
                onClick={() => setPasswordlessOpen(true)}
                className="gap-1.5 mr-auto"
                style={{ borderColor: "color-mix(in srgb, var(--accent) 40%, transparent)", color: "var(--accent)", background: "color-mix(in srgb, var(--accent) 5%, transparent)" }}
                title="Install your SSH key on this host so you don't need a password again"
              >
                <KeyRound className="h-3.5 w-3.5" />
                Set up passwordless first
              </Button>
            )}
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              onClick={handleConnect}
              disabled={!canSubmit}
              className="gap-1.5"
              style={{ background: "var(--accent)", color: "var(--accent-foreground)", border: "none" }}
            >
              {saveSession ? <BookmarkPlus className="h-3.5 w-3.5" /> : <Terminal className="h-3.5 w-3.5" />}
              {connecting ? "Opening…" : saveSession ? "Save & Connect" : "Connect"}
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
        backLabel="Back to quick connect"
      />

      <SetupPasswordlessDialog
        open={passwordlessOpen}
        onClose={() => setPasswordlessOpen(false)}
        target={{ host: host.trim(), port: port ? parseInt(port) : undefined, jumpHost: null }}
        profile={selectedProfile}
        onDone={() => { onProfilesChanged(); }}
      />
    </>
  );
}
