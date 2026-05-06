"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { THEMES, DEFAULT_THEME_ID, getTheme, applyTheme, type Theme } from "@/lib/themes";
import {
  UI_SCALES, FONT_FAMILIES, DEFAULT_SCALE_ID, DEFAULT_FONT_ID,
  applyAppearance,
} from "@/lib/appearance";

const THEME_KEY = "ssh-manager-theme";
const SCALE_KEY = "ssh-manager-scale";
const FONT_KEY = "ssh-manager-font";

interface ThemeContextValue {
  theme: Theme;
  themes: Theme[];
  setTheme: (id: string) => void;
  scaleId: string;
  setScale: (id: string) => void;
  fontId: string;
  setFont: (id: string) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeId, setThemeId] = useState<string>(DEFAULT_THEME_ID);
  const [scaleId, setScaleId] = useState<string>(DEFAULT_SCALE_ID);
  const [fontId, setFontId] = useState<string>(DEFAULT_FONT_ID);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    // Defer the localStorage read into a microtask so the setState calls
    // don't happen synchronously inside the effect body — keeps the
    // react-hooks/set-state-in-effect rule happy.
    void Promise.resolve().then(() => {
      if (cancelled) return;
      const t = localStorage.getItem(THEME_KEY);
      const s = localStorage.getItem(SCALE_KEY);
      const f = localStorage.getItem(FONT_KEY);
      const tId = t && THEMES.some(x => x.id === t) ? t : DEFAULT_THEME_ID;
      const sId = s && UI_SCALES.some(x => x.id === s) ? s : DEFAULT_SCALE_ID;
      const fId = f && FONT_FAMILIES.some(x => x.id === f) ? f : DEFAULT_FONT_ID;
      setThemeId(tId); setScaleId(sId); setFontId(fId);
      applyTheme(getTheme(tId));
      applyAppearance(sId, fId);
    });
    return () => { cancelled = true; };
  }, []);

  const setTheme = useCallback((id: string) => {
    setThemeId(id); applyTheme(getTheme(id));
    try { localStorage.setItem(THEME_KEY, id); } catch {}
  }, []);

  const setScale = useCallback((id: string) => {
    setScaleId(id); applyAppearance(id, fontId);
    try { localStorage.setItem(SCALE_KEY, id); } catch {}
  }, [fontId]);

  const setFont = useCallback((id: string) => {
    setFontId(id); applyAppearance(scaleId, id);
    try { localStorage.setItem(FONT_KEY, id); } catch {}
  }, [scaleId]);

  return (
    <ThemeContext.Provider value={{
      theme: getTheme(themeId), themes: THEMES, setTheme,
      scaleId, setScale,
      fontId, setFont,
    }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
