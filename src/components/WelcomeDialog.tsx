"use client";

// One-time first-launch dialog. Sets a localStorage flag on dismiss so it
// never shows again on the same machine. The whole point is to give the user
// context for the macOS keychain prompt that appears when they save their
// first password — without that context the prompt feels like surveillance.

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { KeyRound, Lock, Sparkles, Terminal as TerminalIcon } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function WelcomeDialog({ open, onClose }: Props) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ background: "color-mix(in srgb, var(--accent) 18%, transparent)" }}>
              <Sparkles className="h-4 w-4" style={{ color: "var(--accent)" }} />
            </div>
            Welcome to SSH Manager
          </DialogTitle>
          <DialogDescription style={{ color: "var(--muted-fg)" }}>
            One thing to know before you start saving credentials.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="flex items-start gap-3 rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: "color-mix(in srgb, var(--accent) 10%, transparent)", color: "var(--accent)" }}>
              <Lock className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-semibold" style={{ color: "var(--foreground)" }}>
                Your passwords live in the OS keychain
              </p>
              <p className="text-[12.5px] mt-1" style={{ color: "var(--muted-fg)" }}>
                Saved passwords and key passphrases never touch the database — they go straight into{" "}
                <span className="font-mono" style={{ color: "var(--foreground)" }}>Keychain Access</span> on macOS,
                where SSH Manager can read them and nothing else can.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-xl border p-3" style={{
            borderColor: "color-mix(in srgb, var(--accent) 30%, transparent)",
            background: "color-mix(in srgb, var(--accent) 5%, transparent)",
          }}>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: "color-mix(in srgb, var(--accent) 18%, transparent)", color: "var(--accent)" }}>
              <KeyRound className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-semibold" style={{ color: "var(--foreground)" }}>
                macOS will ask permission the first time
              </p>
              <p className="text-[12.5px] mt-1" style={{ color: "var(--muted-fg)" }}>
                When you save your first password, macOS will pop a dialog asking SSH Manager for keychain access.
                Click <strong style={{ color: "var(--foreground)" }}>Always Allow</strong> and you won&apos;t see it again.
              </p>
              <p className="text-[11.5px] mt-2" style={{ color: "var(--subtle-fg)" }}>
                After app updates you may be prompted once more. That&apos;s the OS protecting your stored credentials —
                it&apos;s expected.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: "color-mix(in srgb, var(--accent) 10%, transparent)", color: "var(--accent)" }}>
              <TerminalIcon className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-semibold" style={{ color: "var(--foreground)" }}>
                Terminals open inside the app
              </p>
              <p className="text-[12.5px] mt-1" style={{ color: "var(--muted-fg)" }}>
                Click any session card to open a built-in terminal. Stored passwords auto-fill on the password prompt.
                Prefer iTerm or Terminal.app? The classic flow is one click away in the session menu.
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={onClose} style={{ background: "var(--accent)", color: "var(--accent-foreground)", border: "none" }}>
            Got it — let&apos;s go
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
