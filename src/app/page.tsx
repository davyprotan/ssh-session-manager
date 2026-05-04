"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, Search, Server, KeyRound, Terminal, Wifi, Zap } from "lucide-react";
import ThemePicker from "@/components/ThemePicker";
import SessionCard from "@/components/SessionCard";
import ProfileCard from "@/components/ProfileCard";
import SessionDialog from "@/components/SessionDialog";
import ProfileDialog from "@/components/ProfileDialog";
import QuickConnectDialog from "@/components/QuickConnectDialog";
import { toast } from "sonner";
import type { Session, Profile } from "@/lib/types";
import { cn } from "@/lib/utils";

type Tab = "sessions" | "profiles";

export default function Home() {
  const [tab, setTab] = useState<Tab>("sessions");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [search, setSearch] = useState("");

  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<Session | null>(null);
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [quickConnectOpen, setQuickConnectOpen] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<{ type: "session" | "profile"; id: number; name: string } | null>(null);

  const fetchSessions = useCallback(async () => {
    const res = await fetch("/api/sessions");
    setSessions(await res.json());
  }, []);

  const fetchProfiles = useCallback(async () => {
    const res = await fetch("/api/profiles");
    setProfiles(await res.json());
  }, []);

  useEffect(() => { fetchSessions(); fetchProfiles(); }, [fetchSessions, fetchProfiles]);

  async function handleConnect(session: Session) {
    const toastId = toast.loading(`Connecting to ${session.name}…`);
    const res = await fetch("/api/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: session.id }),
    });
    const data = await res.json();
    toast.dismiss(toastId);
    if (res.ok) {
      toast.success(`Opened terminal for ${session.name}`, { description: data.command, duration: 4000 });
      fetchSessions();
    } else {
      toast.error("Failed to open terminal");
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const { type, id, name } = deleteTarget;
    await fetch(`/api/${type === "session" ? "sessions" : "profiles"}/${id}`, { method: "DELETE" });
    toast.success(`"${name}" deleted`);
    setDeleteTarget(null);
    if (type === "session") fetchSessions();
    else { fetchProfiles(); fetchSessions(); }
  }

  const filteredSessions = sessions.filter(s => {
    const q = search.toLowerCase();
    const tags: string[] = JSON.parse(s.tags || "[]");
    return (
      s.name.toLowerCase().includes(q) ||
      s.host.toLowerCase().includes(q) ||
      (s.profile_name || "").toLowerCase().includes(q) ||
      tags.some(t => t.toLowerCase().includes(q))
    );
  });

  const filteredProfiles = profiles.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.username.toLowerCase().includes(search.toLowerCase())
  );

  const sessionCountByProfile = sessions.reduce<Record<number, number>>((acc, s) => {
    if (s.profile_id) acc[s.profile_id] = (acc[s.profile_id] || 0) + 1;
    return acc;
  }, {});

  function openNewSession() { setEditingSession(null); setSessionDialogOpen(true); }
  function openNewProfile() { setEditingProfile(null); setProfileDialogOpen(true); }

  return (
    <div className="flex flex-col min-h-screen" style={{ background: "var(--background)" }}>
      {/* Header */}
      <header className="sticky top-0 z-20 border-b" style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--background) 85%, transparent)", backdropFilter: "blur(12px)" }}>
        <div className="max-w-5xl mx-auto px-5 h-14 flex items-center gap-3">
          {/* Logo */}
          <div className="flex items-center gap-2.5 shrink-0 mr-2">
            <div className="relative flex h-8 w-8 items-center justify-center rounded-xl" style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--accent) 25%, transparent), color-mix(in srgb, var(--accent) 8%, transparent))", border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)" }}>
              <Terminal className="h-4 w-4" style={{ color: "var(--accent)" }} />
            </div>
            <span className="font-semibold text-sm" style={{ color: "var(--foreground)" }}>SSH Manager</span>
          </div>

          {/* Tabs */}
          <nav className="flex gap-1">
            <TabButton active={tab === "sessions"} onClick={() => setTab("sessions")} icon={<Server className="h-3.5 w-3.5" />} count={sessions.length}>
              Sessions
            </TabButton>
            <TabButton active={tab === "profiles"} onClick={() => setTab("profiles")} icon={<KeyRound className="h-3.5 w-3.5" />} count={profiles.length}>
              Profiles
            </TabButton>
          </nav>

          <div className="flex-1" />

          {/* Search */}
          <div className="relative w-52">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none" style={{ color: "var(--muted-foreground)" }} />
            <Input
              className="pl-8 h-8 text-sm"
              style={{ background: "var(--muted)", borderColor: "var(--border)", color: "var(--foreground)" }}
              placeholder="Search…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          {/* Theme picker */}
          <ThemePicker />

          {/* Quick Connect */}
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-sm font-medium"
            style={{ borderColor: "color-mix(in srgb, var(--accent) 40%, transparent)", color: "var(--accent)", background: "color-mix(in srgb, var(--accent) 5%, transparent)" }}
            onClick={() => setQuickConnectOpen(true)}
            title="Connect to a host without saving it"
          >
            <Zap className="h-3.5 w-3.5" />
            Quick connect
          </Button>

          {/* CTA */}
          <Button
            size="sm"
            className="h-8 gap-1.5 text-sm font-medium"
            style={{ background: "var(--accent)", color: "var(--accent-foreground)", border: "none" }}
            onClick={tab === "sessions" ? openNewSession : openNewProfile}
          >
            <Plus className="h-3.5 w-3.5" />
            {tab === "sessions" ? "New session" : "New profile"}
          </Button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-5 py-7">
        {tab === "sessions" && (
          <>
            {sessions.length === 0 ? (
              <EmptyState
                icon={<Wifi className="h-12 w-12" />}
                title="No sessions yet"
                description="Add your first server to get started. Set up a credential profile first, then create sessions."
                action={
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={openNewProfile} className="gap-1.5" style={{ borderColor: "var(--border)", color: "var(--muted-foreground)" }}>
                      <KeyRound className="h-3.5 w-3.5" />New profile
                    </Button>
                    <Button size="sm" onClick={openNewSession} className="gap-1.5" style={{ background: "var(--accent)", color: "var(--accent-foreground)", border: "none" }}>
                      <Plus className="h-3.5 w-3.5" />New session
                    </Button>
                  </div>
                }
              />
            ) : filteredSessions.length === 0 ? (
              <EmptyState icon={<Search className="h-12 w-12" />} title="No results" description={`Nothing matches "${search}"`} />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filteredSessions.map(s => (
                  <SessionCard
                    key={s.id}
                    session={s}
                    onConnect={handleConnect}
                    onEdit={s => { setEditingSession(s); setSessionDialogOpen(true); }}
                    onDelete={s => setDeleteTarget({ type: "session", id: s.id, name: s.name })}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {tab === "profiles" && (
          <>
            {profiles.length === 0 ? (
              <EmptyState
                icon={<KeyRound className="h-12 w-12" />}
                title="No credential profiles"
                description="Profiles store your username and SSH key or password. Create one and reuse it across sessions."
                action={
                  <Button size="sm" onClick={openNewProfile} className="gap-1.5" style={{ background: "var(--accent)", color: "var(--accent-foreground)", border: "none" }}>
                    <Plus className="h-3.5 w-3.5" />New profile
                  </Button>
                }
              />
            ) : filteredProfiles.length === 0 ? (
              <EmptyState icon={<Search className="h-12 w-12" />} title="No results" description={`Nothing matches "${search}"`} />
            ) : (
              <div className="flex flex-col gap-2">
                {filteredProfiles.map(p => (
                  <ProfileCard
                    key={p.id}
                    profile={p}
                    sessionCount={sessionCountByProfile[p.id] || 0}
                    onEdit={p => { setEditingProfile(p); setProfileDialogOpen(true); }}
                    onDelete={p => setDeleteTarget({ type: "profile", id: p.id, name: p.name })}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {/* Dialogs */}
      <SessionDialog
        open={sessionDialogOpen}
        onClose={() => setSessionDialogOpen(false)}
        onSave={fetchSessions}
        session={editingSession}
        profiles={profiles}
        onProfilesChanged={() => { fetchProfiles(); fetchSessions(); }}
      />
      <ProfileDialog
        open={profileDialogOpen}
        onClose={() => setProfileDialogOpen(false)}
        onSave={() => { fetchProfiles(); fetchSessions(); }}
        profile={editingProfile}
      />
      <QuickConnectDialog
        open={quickConnectOpen}
        onClose={() => setQuickConnectOpen(false)}
        profiles={profiles}
        onProfilesChanged={() => { fetchProfiles(); fetchSessions(); }}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.type}?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>&quot;{deleteTarget?.name}&quot;</strong> will be permanently removed.
              {deleteTarget?.type === "profile" && " Sessions using this profile won't be deleted but will lose their credential link."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction style={{ background: "var(--destructive)", color: "#fff" }} onClick={handleDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TabButton({ active, onClick, icon, count, children }: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150"
      style={active
        ? { color: "var(--accent)", background: "color-mix(in srgb, var(--accent) 10%, transparent)" }
        : { color: "var(--muted-foreground)", background: "transparent" }
      }
    >
      {icon}
      {children}
      {count > 0 && (
        <span
          className="text-xs tabular-nums rounded-full px-1.5 min-w-5 text-center leading-5"
          style={active
            ? { background: "color-mix(in srgb, var(--accent) 15%, transparent)", color: "var(--accent)" }
            : { background: "var(--muted)", color: "var(--muted-foreground)" }
          }
        >
          {count}
        </span>
      )}
    </button>
  );
}

function EmptyState({ icon, title, description, action }: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-28 gap-5 text-center select-none">
      <div style={{ color: "rgba(139,148,158,0.25)" }}>{icon}</div>
      <div className="space-y-1.5">
        <h2 className="font-semibold text-base" style={{ color: "var(--foreground)" }}>{title}</h2>
        <p className="text-sm max-w-sm mx-auto leading-relaxed" style={{ color: "var(--muted-foreground)" }}>{description}</p>
      </div>
      {action}
    </div>
  );
}
