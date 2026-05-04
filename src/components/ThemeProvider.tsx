"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { THEMES, DEFAULT_THEME_ID, getTheme, applyTheme, type Theme } from "@/lib/themes";

const STORAGE_KEY = "ssh-manager-theme";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (id: string) => void;
  themes: Theme[];
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeId, setThemeId] = useState<string>(DEFAULT_THEME_ID);

  // Initial load from localStorage
  useEffect(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    const id = stored && THEMES.some(t => t.id === stored) ? stored : DEFAULT_THEME_ID;
    setThemeId(id);
    applyTheme(getTheme(id));
  }, []);

  const setTheme = useCallback((id: string) => {
    setThemeId(id);
    applyTheme(getTheme(id));
    try { localStorage.setItem(STORAGE_KEY, id); } catch {}
  }, []);

  return (
    <ThemeContext.Provider value={{ theme: getTheme(themeId), setTheme, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
