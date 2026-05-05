"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Palette, Check, Type, ALargeSmall } from "lucide-react";
import { useTheme } from "./ThemeProvider";
import { UI_SCALES, FONT_FAMILIES } from "@/lib/appearance";

export default function ThemePicker() {
  const { theme, setTheme, themes, scaleId, setScale, fontId, setFont } = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="h-8 w-8 p-0"
        onClick={() => setOpen(true)}
        title="Appearance — theme, size, font"
        aria-label="Appearance settings"
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
              Appearance
            </DialogTitle>
            <DialogDescription style={{ color: "var(--muted-fg)" }}>
              Pick a color theme, text size, and font. Saved automatically.
            </DialogDescription>
          </DialogHeader>

          {/* Color theme */}
          <Section icon={<Palette className="h-3.5 w-3.5" />} label="Color theme">
            <div className="grid grid-cols-2 gap-3">
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
          </Section>

          {/* UI scale */}
          <Section icon={<ALargeSmall className="h-3.5 w-3.5" />} label="Text size">
            <div className="grid grid-cols-4 gap-2">
              {UI_SCALES.map(s => {
                const selected = s.id === scaleId;
                return (
                  <button
                    key={s.id}
                    onClick={() => setScale(s.id)}
                    className="flex flex-col items-center justify-center gap-1.5 rounded-xl border p-3 transition-all"
                    style={{
                      background: selected ? "color-mix(in srgb, var(--accent) 10%, transparent)" : "transparent",
                      borderColor: selected ? "var(--accent)" : "var(--border)",
                      color: selected ? "var(--accent)" : "var(--foreground)",
                    }}
                  >
                    <span style={{ fontSize: `${0.7 * s.zoom}rem`, lineHeight: 1.2, fontWeight: 600 }}>Aa</span>
                    <span className="text-[11px]" style={{ color: selected ? "var(--accent)" : "var(--muted-fg)" }}>{s.name}</span>
                  </button>
                );
              })}
            </div>
          </Section>

          {/* Font family */}
          <Section icon={<Type className="h-3.5 w-3.5" />} label="Font">
            <div className="flex flex-col gap-1.5">
              {FONT_FAMILIES.map(f => {
                const selected = f.id === fontId;
                return (
                  <button
                    key={f.id}
                    onClick={() => setFont(f.id)}
                    className="flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-all text-left"
                    style={{
                      background: selected ? "color-mix(in srgb, var(--accent) 8%, transparent)" : "transparent",
                      borderColor: selected ? "var(--accent)" : "var(--border)",
                    }}
                  >
                    <span
                      className="text-base font-semibold w-12 text-center"
                      style={{ fontFamily: f.stack, color: selected ? "var(--accent)" : "var(--foreground)" }}
                    >
                      Aa
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-medium" style={{ color: "var(--foreground)" }}>{f.name}</p>
                      <p className="text-[12px]" style={{ color: "var(--muted-fg)" }}>{f.description}</p>
                    </div>
                    {selected && (
                      <div className="flex h-5 w-5 items-center justify-center rounded-full shrink-0" style={{ background: "var(--accent)" }}>
                        <Check className="h-3 w-3" style={{ color: "var(--accent-foreground)" }} strokeWidth={3} />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </Section>

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

function Section({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 py-2">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted-fg)" }}>
        {icon}
        {label}
      </div>
      {children}
    </div>
  );
}
