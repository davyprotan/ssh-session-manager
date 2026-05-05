"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Server, KeyRound, Terminal, Wifi, Zap, Settings, FolderClosed, ArrowUpDown } from "lucide-react";
import ThemePicker from "@/components/ThemePicker";
import SessionCard from "@/components/SessionCard";
import ProfileCard from "@/components/ProfileCard";
import SessionDialog from "@/components/SessionDialog";
import ProfileDialog from "@/components/ProfileDialog";
import QuickConnectDialog from "@/components/QuickConnectDialog";
import SettingsDialog from "@/components/SettingsDialog";
import ImportSshConfigDialog from "@/components/ImportSshConfigDialog";
import { toast } from "sonner";
import type { Session, Profile, Folder } from "@/lib/types";
import { COLOR_HEX, type ProfileColor } from "@/lib/profile-colors";
import { cn } from "@/lib/utils";

type Tab = "sessions" | "profiles";
type SortBy = "name" | "last_connected" | "created";

const SORT_KEY = "ssh-manager-sort";

export default function Home() {
  const [tab, setTab] = useState<Tab>("sessions");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("name");

  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<Session | null>(null);
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [quickConnectOpen, setQuickConnectOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sshImportOpen, setSshImportOpen] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<{ type: "session" | "profile"; id: number; name: string } | null>(null);

  const fetchSessions = useCallback(async () => {
    const res = await fetch("/api/sessions");
    setSessions(await res.json());
  }, []);

  const fetchProfiles = useCallback(async () => {
    const res = await fetch("/api/profiles");
    setProfiles(await res.json());
  }, []);

  const fetchFolders = useCallback(async () => {
    const res = await fetch("/api/folders");
    setFolders(await res.json());
  }, []);

  useEffect(() => {
    fetchSessions(); fetchProfiles(); fetchFolders();
    // Restore sort preference
    try {
      const saved = localStorage.getItem(SORT_KEY) as SortBy | null;
      if (saved) setSortBy(saved);
    } catch {}
  }, [fetchSessions, fetchProfiles, fetchFolders]);

  function changeSort(s: SortBy) {
    setSortBy(s);
    try { localStorage.setItem(SORT_KEY, s); } catch {}
  }

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

  async function handleClone(session: Session) {
    const res = await fetch(`/api/sessions/${session.id}/clone`, { method: "POST" });
    if (res.ok) {
      const cloned: Session = await res.json();
      toast.success(`Duplicated as "${cloned.name}"`);
      fetchSessions();
    } else {
      toast.error("Failed to duplicate session");
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

  // Filter + sort sessions
  const filteredSortedSessions = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = sessions.filter(s => {
      const tags: string[] = JSON.parse(s.tags || "[]");
      return (
        s.name.toLowerCase().includes(q) ||
        s.host.toLowerCase().includes(q) ||
        (s.profile_name || "").toLowerCase().includes(q) ||
        (s.folder_name || "").toLowerCase().includes(q) ||
        tags.some(t => t.toLowerCase().includes(q))
      );
    });

    return filtered.sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "created") return (b.created_at || "").localeCompare(a.created_at || "");
      // last_connected — most recent first, never-connected last
      if (!a.last_connected_at && !b.last_connected_at) return a.name.localeCompare(b.name);
      if (!a.last_connected_at) return 1;
      if (!b.last_connected_at) return -1;
      return b.last_connected_at.localeCompare(a.last_connected_at);
    });
  }, [sessions, search, sortBy]);

  // Group sessions by folder
  const groupedSessions = useMemo(() => {
    const groups: Map<string, { folder: Folder | null; sessions: Session[] }> = new Map();
    groups.set("__none", { folder: null, sessions: [] });
    for (const f of folders) groups.set(String(f.id), { folder: f, sessions: [] });
    for (const s of filteredSortedSessions) {
      const key = s.folder_id ? String(s.folder_id) : "__none";
      const g = groups.get(key);
      if (g) g.sessions.push(s);
      else groups.get("__none")!.sessions.push(s);
    }
    return Array.from(groups.values()).filter(g => g.sessions.length > 0);
  }, [filteredSortedSessions, folders]);

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

  function refreshAll() { fetchSessions(); fetchProfiles(); fetchFolders(); }

  return (
    <div className="flex flex-col min-h-screen" style={{ background: "var(--background)" }}>
      {/* Header */}
      <header className="sticky top-0 z-20 border-b" style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--background) 85%, transparent)", backdropFilter: "blur(12px)" }}>
        <div className="max-w-5xl mx-auto px-5 h-14 flex items-center gap-3">
          <button
            onClick={() => { setTab("sessions"); setSearch(""); }}
            className="flex items-center gap-2.5 shrink-0 mr-2 rounded-lg px-1 -mx-1 py-1 -my-1 transition-colors hover:bg-accent/40"
            title="Go to dashboard"
          >
            <div className="relative flex h-8 w-8 items-center justify-center rounded-xl" style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--accent) 25%, transparent), color-mix(in srgb, var(--accent) 8%, transparent))", border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)" }}>
              <Terminal className="h-4 w-4" style={{ color: "var(--accent)" }} />
            </div>
            <span className="font-semibold text-sm" style={{ color: "var(--foreground)" }}>SSH Manager</span>
          </button>

          <nav className="flex gap-1">
            <TabButton active={tab === "sessions"} onClick={() => setTab("sessions")} icon={<Server className="h-3.5 w-3.5" />} count={sessions.length}>
              Sessions
            </TabButton>
            <TabButton active={tab === "profiles"} onClick={() => setTab("profiles")} icon={<KeyRound className="h-3.5 w-3.5" />} count={profiles.length}>
              Profiles
            </TabButton>
          </nav>

          <div className="flex-1" />

          <div className="relative w-48">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none" style={{ color: "var(--muted-fg)" }} />
            <Input
              className="pl-8 h-8 text-sm"
              style={{ background: "var(--muted)", borderColor: "var(--border)", color: "var(--foreground)" }}
              placeholder="Search…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          {tab === "sessions" && (
            <Select value={sortBy} onValueChange={(v) => v && changeSort(v as SortBy)}>
              <SelectTrigger className="h-8 w-auto gap-1 px-2 text-sm" style={{ background: "var(--muted)", borderColor: "var(--border)", color: "var(--muted-fg)" }} title="Sort sessions">
                <ArrowUpDown className="h-3.5 w-3.5" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Sort by name</SelectItem>
                <SelectItem value="last_connected">Recently connected</SelectItem>
                <SelectItem value="created">Recently added</SelectItem>
              </SelectContent>
            </Select>
          )}

          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => setSettingsOpen(true)} title="Settings, import & export" aria-label="Settings, import & export" style={{ color: "var(--muted-fg)" }}>
            <Settings className="h-4 w-4" />
          </Button>

          <ThemePicker />

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

      <main className="flex-1 max-w-5xl mx-auto w-full px-5 py-7">
        {tab === "sessions" && (
          <>
            {sessions.length === 0 ? (
              <EmptyState
                icon={<Wifi className="h-12 w-12" />}
                title="No sessions yet"
                description="Add servers manually, or import them from your existing ~/.ssh/config in one click."
                action={
                  <div className="flex flex-wrap gap-2 justify-center">
                    <Button variant="outline" size="sm" onClick={() => setSshImportOpen(true)} className="gap-1.5" style={{ borderColor: "var(--border)", color: "var(--muted-fg)" }}>
                      Import from ~/.ssh/config
                    </Button>
                    <Button variant="outline" size="sm" onClick={openNewProfile} className="gap-1.5" style={{ borderColor: "var(--border)", color: "var(--muted-fg)" }}>
                      <KeyRound className="h-3.5 w-3.5" />New profile
                    </Button>
                    <Button size="sm" onClick={openNewSession} className="gap-1.5" style={{ background: "var(--accent)", color: "var(--accent-foreground)", border: "none" }}>
                      <Plus className="h-3.5 w-3.5" />New session
                    </Button>
                  </div>
                }
              />
            ) : filteredSortedSessions.length === 0 ? (
              <EmptyState icon={<Search className="h-12 w-12" />} title="No results" description={`Nothing matches "${search}"`} />
            ) : (
              <div className="space-y-6">
                {groupedSessions.map(group => (
                  <FolderSection
                    key={group.folder?.id ?? "__none"}
                    folder={group.folder}
                    sessions={group.sessions}
                    onConnect={handleConnect}
                    onEdit={s => { setEditingSession(s); setSessionDialogOpen(true); }}
                    onClone={handleClone}
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

      <SessionDialog
        open={sessionDialogOpen}
        onClose={() => setSessionDialogOpen(false)}
        onSave={fetchSessions}
        session={editingSession}
        profiles={profiles}
        folders={folders}
        onProfilesChanged={() => { fetchProfiles(); fetchSessions(); }}
        onFoldersChanged={fetchFolders}
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
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onChanged={refreshAll}
        onOpenSshImport={() => setSshImportOpen(true)}
      />
      <ImportSshConfigDialog
        open={sshImportOpen}
        onClose={() => setSshImportOpen(false)}
        onImported={refreshAll}
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

function FolderSection({ folder, sessions, onConnect, onEdit, onClone, onDelete }: {
  folder: Folder | null;
  sessions: Session[];
  onConnect: (s: Session) => void;
  onEdit: (s: Session) => void;
  onClone: (s: Session) => void;
  onDelete: (s: Session) => void;
}) {
  const color = folder ? COLOR_HEX[(folder.color as ProfileColor) || 'cyan'] || COLOR_HEX.cyan : null;
  return (
    <section>
      {folder && (
        <div className="flex items-center gap-2 mb-3 px-1">
          <FolderClosed className="h-4 w-4" style={{ color: color! }} />
          <h2 className="text-[13px] font-semibold tracking-tight" style={{ color: "var(--foreground)" }}>
            {folder.name}
          </h2>
          <span className="text-[12px]" style={{ color: "var(--subtle-fg)" }}>{sessions.length}</span>
          <div className="flex-1 h-px" style={{ background: "var(--border)" }} />
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sessions.map(s => (
          <SessionCard
            key={s.id}
            session={s}
            onConnect={onConnect}
            onEdit={onEdit}
            onClone={onClone}
            onDelete={onDelete}
          />
        ))}
      </div>
    </section>
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
        : { color: "var(--muted-fg)", background: "transparent" }
      }
    >
      {icon}
      {children}
      {count > 0 && (
        <span
          className="text-xs tabular-nums rounded-full px-1.5 min-w-5 text-center leading-5"
          style={active
            ? { background: "color-mix(in srgb, var(--accent) 15%, transparent)", color: "var(--accent)" }
            : { background: "var(--muted)", color: "var(--muted-fg)" }
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
      <div style={{ color: "var(--subtle-fg)", opacity: 0.45 }}>{icon}</div>
      <div className="space-y-2">
        <h2 className="font-semibold text-lg tracking-tight" style={{ color: "var(--foreground)" }}>{title}</h2>
        <p className="text-[14px] leading-relaxed max-w-sm mx-auto" style={{ color: "var(--muted-fg)" }}>{description}</p>
      </div>
      {action}
    </div>
  );
}
