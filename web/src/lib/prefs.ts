import { useSyncExternalStore } from "react";

export type ThemePref = "system" | "light" | "dark";
export type CaptionSize = "md" | "lg" | "xl";

export interface Prefs {
  theme: ThemePref;
  caption: CaptionSize;
}

const KEY = "callproxy:prefs";
const listeners = new Set<() => void>();
const darkQuery = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;

function read(): Prefs {
  let stored: Partial<Prefs> = {};
  try {
    stored = JSON.parse(localStorage.getItem(KEY) || "{}") ?? {};
  } catch {
    /* storage can be blocked; defaults are fine */
  }
  return {
    theme: stored.theme === "light" || stored.theme === "dark" ? stored.theme : "system",
    caption: stored.caption === "lg" || stored.caption === "xl" ? stored.caption : "md",
  };
}

let current = read();

function apply(prefs: Prefs) {
  const root = document.documentElement;
  const dark = prefs.theme === "dark" || (prefs.theme === "system" && !!darkQuery?.matches);
  root.dataset.theme = dark ? "dark" : "light";
  root.dataset.caption = prefs.caption;
}

darkQuery?.addEventListener("change", () => {
  if (current.theme === "system") apply(current);
});

export function setPrefs(patch: Partial<Prefs>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* ignore */
  }
  apply(current);
  listeners.forEach((l) => l());
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}
