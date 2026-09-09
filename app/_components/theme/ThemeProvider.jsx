"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

import { THEME_COOKIE, COOKIE_MAX_AGE_SECONDS } from "@/lib/i18n/constants";

const ThemeContext = createContext(null);

/**
 * Client-side theme state, seeded from the SERVER-read `theme` cookie (see
 * app/layout.js, which sets the `.dark` class on <html> BEFORE this ever
 * mounts — no flash of the wrong theme on load or navigation). Persistence
 * is the cookie alone (readable server-side, unlike localStorage), so a
 * refresh, a new tab, or a PWA relaunch all see the same choice.
 */
export function ThemeProvider({ initialTheme, children }) {
  const [theme, setThemeState] = useState(initialTheme === "dark" ? "dark" : "light");

  const setTheme = useCallback((next) => {
    const value = next === "dark" ? "dark" : "light";
    setThemeState(value);
    if (typeof document !== "undefined") {
      document.cookie = `${THEME_COOKIE}=${value}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
      document.documentElement.classList.toggle("dark", value === "dark");
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** @returns {{theme:"light"|"dark", setTheme:(t:string)=>void, toggleTheme:()=>void}} */
export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}
