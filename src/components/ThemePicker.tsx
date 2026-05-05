"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Palette, Check } from "lucide-react";
import { useTheme } from "./ThemeProvider";

export default function ThemePicker() {
  const { theme, setTheme, themes } = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="h-8 w-8 p-0"
        onClick={() => setOpen(true)}
        title="Theme"
        style={{ color: "var(--muted-fg)" }}
      >
        <Palette className="h-4 w-4" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="sm:max-w-2xl max-h-[90vh] overflow-y-auto"
          style={{ background: "var(--card)", borderColor: "var(--border)" }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Palette className="h-5 w-5" style={{ color: "var(--accent)" }} />
              Choose a theme
            </DialogTitle>
            <DialogDescription style={{ color: "var(--muted-fg)" }}>
              Pick the look that suits you. Saved automatically.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3 py-2">
            {themes.map(t => {
              const selected = t.id === theme.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTheme(t.id)}
                  className="group relative flex flex-col gap-3 rounded-xl border p-3 text-left transition-all duration-150"
                  style={{
                    background: t.bg,
                    color: t.fg,
                    borderColor: selected ? t.accent : "transparent",
                    boxShadow: selected ? `0 0 0 1px ${t.accent}, 0 4px 18px ${t.accent}40` : "none",
                  }}
                >
                  {/* Mini-preview */}
                  <div className="flex flex-col gap-2 rounded-lg p-2.5" style={{ background: t.card, border: `1px solid ${t.border}` }}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <div className="h-2 w-2 rounded-full" style={{ background: t.accent }} />
                        <div className="h-1.5 w-12 rounded-full" style={{ background: t.fg, opacity: 0.7 }} />
                      </div>
                      <div className="h-1 w-1 rounded-full" style={{ background: t.mutedFg }} />
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-1.5 rounded-full" style={{ background: t.accent, opacity: 0.5 }} />
                      <div className="h-1 w-16 rounded-full" style={{ background: t.mutedFg, opacity: 0.6 }} />
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-3 px-1.5 rounded text-[8px] flex items-center" style={{ background: t.accent, color: t.accentForeground }}>
                        Connect
                      </div>
                      <div className="flex-1" />
                      <div className="h-1 w-8 rounded-full" style={{ background: t.mutedFg, opacity: 0.4 }} />
                    </div>
                  </div>

                  {/* Name + selected indicator */}
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold" style={{ color: t.fg }}>{t.name}</p>
                      <p className="text-xs mt-0.5" style={{ color: t.mutedFg }}>{t.description}</p>
                    </div>
                    {selected && (
                      <div className="flex h-5 w-5 items-center justify-center rounded-full shrink-0" style={{ background: t.accent }}>
                        <Check className="h-3 w-3" style={{ color: t.accentForeground }} strokeWidth={3} />
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          <DialogFooter>
            <Button
              onClick={() => setOpen(false)}
              style={{ background: "var(--accent)", color: "var(--accent-foreground)", border: "none" }}
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
