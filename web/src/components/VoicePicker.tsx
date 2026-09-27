import { Check, ChevronDown, Loader2, Play } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { previewVoice } from "../lib/speech";
import type { Voice } from "../types";

interface Props {
  label: string;
  voices: Voice[];
  value: string | null | undefined;
  onChange: (voiceId: string) => void;
  /** Whether ElevenLabs can voice a preview (server has a key). */
  tts: boolean;
  sample: string;
  compact?: boolean;
  /** Open the list upward (for pickers docked at the bottom of the screen). */
  openUp?: boolean;
  /** Just the voice's badge, for sitting inside an input row. */
  inline?: boolean;
}

function meta(v: Voice) {
  return [v.accent, v.gender].filter(Boolean).join(" · ");
}

/**
 * Pick an ElevenLabs voice. A disclosure button opens a panel of native radio buttons
 * (arrow keys move between voices), each with a preview.
 */
export function VoicePicker({ label, voices, value, onChange, tts, sample, compact = false, openUp = false, inline = false }: Props) {
  const [open, setOpen] = useState(false);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const current = voices.find((v) => v.voice_id === value) ?? voices[0];

  useEffect(() => {
    if (!open) return;
    const panel = root.current?.querySelector<HTMLInputElement>("input[type=radio]:checked, input[type=radio]");
    panel?.focus();
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const preview = async (v: Voice) => {
    setPreviewing(v.voice_id);
    try {
      await previewVoice(v.voice_id, v.preview_url, tts, sample);
    } finally {
      setPreviewing(null);
    }
  };
  const canPreview = (v: Voice) => !!v.preview_url || tts;

  return (
    <div ref={root} className="relative">
      {inline ? (
        <button
          ref={button}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`${label}: ${current?.name ?? "loading"}. Change voice`}
          title={`${label}: ${current?.name ?? ""}`}
          onClick={() => setOpen((o) => !o)}
          className="flex min-h-11 cursor-pointer items-center gap-1 rounded-xl px-1.5 hover:bg-surface-2"
        >
          <VoiceBadge name={current?.name ?? "…"} />
          <ChevronDown className={`size-4 text-ink-2 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
      ) : (
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full cursor-pointer items-center gap-3 rounded-xl border-2 border-line-strong bg-surface text-left transition-colors hover:border-accent ${
          compact ? "min-h-10 px-3 py-1.5" : "min-h-14 px-3.5 py-2"
        }`}
      >
        <VoiceBadge name={current?.name ?? "…"} />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block text-xs font-bold text-ink-2">{label}</span>
          <span className="block truncate text-base font-bold text-ink">
            {current?.name ?? "Loading voices…"}
            {!compact && current && <span className="font-normal text-ink-2"> · {meta(current)}</span>}
          </span>
        </span>
        <ChevronDown className={`size-5 shrink-0 text-ink-2 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      )}

      {open && (
        <div
          id={panelId}
          className={`absolute z-40 w-[min(24rem,calc(100vw-2rem))] animate-fade-in rounded-2xl border border-line bg-surface p-2 shadow-card ${
            openUp ? (inline ? "left-0 bottom-full mb-3" : "right-0 bottom-full mb-2") : "left-0 top-full mt-2"
          }`}
        >
          <fieldset>
            <legend className="px-2 pt-1 pb-2 text-sm font-bold text-ink-2">
              {label} <span className="font-normal">· ElevenLabs</span>
            </legend>
            <ul className="max-h-72 space-y-1 overflow-y-auto">
              {voices.map((v) => {
                const checked = v.voice_id === current?.voice_id;
                return (
                  <li key={v.voice_id} className="flex items-center gap-1">
                    <label
                      className={`flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-accent ${
                        checked ? "bg-accent-soft" : "hover:bg-surface-2"
                      }`}
                    >
                      <input
                        type="radio"
                        name={panelId}
                        className="sr-only"
                        checked={checked}
                        onChange={() => onChange(v.voice_id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            setOpen(false);
                            button.current?.focus();
                          }
                        }}
                      />
                      <VoiceBadge name={v.name} />
                      <span className="min-w-0 flex-1 leading-tight">
                        <span className="block font-bold text-ink">{v.name}</span>
                        <span className="block truncate text-sm text-ink-2">
                          {[meta(v), v.description].filter(Boolean).join(" — ")}
                        </span>
                      </span>
                      {checked && <Check className="size-5 shrink-0 text-accent-ink" aria-hidden="true" />}
                    </label>
                    <button
                      type="button"
                      onClick={() => void preview(v)}
                      disabled={!canPreview(v) || previewing !== null}
                      title={canPreview(v) ? `Hear ${v.name}` : "Add ELEVENLABS_API_KEY to hear ElevenLabs voices"}
                      aria-label={`Preview ${v.name}`}
                      className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-xl text-ink-2 hover:bg-surface-2 hover:text-accent-ink disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {previewing === v.voice_id ? (
                        <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
                      ) : (
                        <Play className="size-4" aria-hidden="true" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            {!tts && (
              <p className="px-2 pt-2 pb-1 text-xs text-ink-2">
                Previews need an ElevenLabs key. Practice calls use your browser's voice until then.
              </p>
            )}
          </fieldset>
        </div>
      )}
    </div>
  );
}

const HUES = ["bg-accent-soft text-accent-ink", "bg-ok-soft text-ok-ink", "bg-warn-soft text-warn-ink", "bg-bad-soft text-bad-ink"];

function VoiceBadge({ name }: { name: string }) {
  const hue = HUES[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];
  return (
    <span className={`grid size-9 shrink-0 place-items-center rounded-full text-sm font-extrabold ${hue}`} aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
