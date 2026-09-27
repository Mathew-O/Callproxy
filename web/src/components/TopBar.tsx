import { Monitor, Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { setPrefs, usePrefs, type CaptionSize, type ThemePref } from "../lib/prefs";
import { Brand } from "./Brand";
import { DemoLauncher } from "./DemoLauncher";

export function TopBar({ children }: { children?: ReactNode }) {
  return (
    <header className="relative z-10">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <Brand />
        <div className="flex flex-wrap items-center gap-2">
          {children}
          <CaptionControl />
          <ThemeControl />
          <DemoLauncher />
        </div>
      </div>
    </header>
  );
}

function Segmented<T extends string>(props: {
  label: string;
  value: T;
  options: { value: T; label: string; content: ReactNode }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={props.label} className="flex rounded-xl border border-line bg-surface p-1 shadow-sm">
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={props.value === o.value}
          aria-label={o.label}
          title={o.label}
          onClick={() => props.onChange(o.value)}
          className="grid min-h-9 min-w-9 cursor-pointer place-items-center rounded-lg px-2 text-ink-2 transition-colors hover:text-ink aria-pressed:bg-accent-soft aria-pressed:text-accent-ink"
        >
          {o.content}
        </button>
      ))}
    </div>
  );
}

export function CaptionControl() {
  const { caption } = usePrefs();
  return (
    <Segmented<CaptionSize>
      label="Caption size"
      value={caption}
      onChange={(value) => setPrefs({ caption: value })}
      options={[
        { value: "md", label: "Normal captions", content: <span className="text-sm font-bold">A</span> },
        { value: "lg", label: "Large captions", content: <span className="text-base font-bold">A</span> },
        { value: "xl", label: "Extra large captions", content: <span className="text-xl leading-none font-bold">A</span> },
      ]}
    />
  );
}

export function ThemeControl() {
  const { theme } = usePrefs();
  return (
    <Segmented<ThemePref>
      label="Color theme"
      value={theme}
      onChange={(value) => setPrefs({ theme: value })}
      options={[
        { value: "system", label: "Match my device", content: <Monitor className="size-4" aria-hidden="true" /> },
        { value: "light", label: "Light theme", content: <Sun className="size-4" aria-hidden="true" /> },
        { value: "dark", label: "Dark theme", content: <Moon className="size-4" aria-hidden="true" /> },
      ]}
    />
  );
}
