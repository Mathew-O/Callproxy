import { ArrowUpRight, Hand, Keyboard, Loader2, Send, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { introductionFor } from "../lib/phrases";
import type { Call, CallMode, Voice } from "../types";
import { SpeakingBars } from "./Avatar";
import { VoicePicker } from "./VoicePicker";

interface Props {
  call: Call;
  voices: Voice[];
  voiceId: string | null;
  onVoice: (voiceId: string) => void;
  tts: boolean;
  enabled: boolean;
  onSay: (text: string) => Promise<void>;
  onMode: (mode: CallMode) => Promise<void>;
  /** The text box's contents, owned by the screen so the autoplay demo can type into it. */
  draft: string;
  onDraft: (text: string) => void;
}

const QUICK = ["Could you repeat that?", "Please speak slower.", "One moment, please.", "Yes.", "No, thank you.", "Thank you!"];

/**
 * The heart of the call screen: type a line and it's spoken on the call in your chosen
 * ElevenLabs voice. You can take the call from the agent, or hand it back, any time.
 */
export function Composer({ call, voices, voiceId, onVoice, tts, enabled, onSay, onMode, draft: text, onDraft: setText }: Props) {
  const [sending, setSending] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const direct = call.mode === "direct";
  const user = call.task.user_name;
  const voiceName = voices.find((v) => v.voice_id === voiceId)?.name ?? "your voice";
  const introduction = introductionFor(user);
  const typedLines = call.transcript.filter((t) => t.via === "typed");
  const speaking = typedLines.find((t) => t.status === "speaking");
  const queued = typedLines.filter((t) => t.status === "queued").length;
  const introduced = typedLines.some((t) => t.text === introduction);

  // Taking the call over puts the cursor where the typing happens.
  useEffect(() => {
    if (direct && enabled) box.current?.focus();
  }, [direct, enabled]);

  // Grow with the text, up to about four lines.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    // An empty box measures its placeholder, so only grow once there's text.
    if (text) el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);

  const say = async (line: string, clear: boolean) => {
    if (!line.trim() || sending || !enabled) return;
    setSending(true);
    setError(null);
    try {
      await onSay(line.trim());
      if (clear) setText("");
      box.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send that line.");
    } finally {
      setSending(false);
    }
  };

  const switchMode = async () => {
    setSwitching(true);
    setError(null);
    try {
      await onMode(direct ? "agent" : "direct");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't switch.");
    } finally {
      setSwitching(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void say(text, true);
    }
  };

  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void say(text, true);
      }}
      className="mx-auto max-w-4xl px-4 pt-3 pb-4 sm:px-6"
      aria-label="Speak on the call"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 basis-64 items-center gap-2.5">
          <span
            className={`grid size-9 shrink-0 place-items-center rounded-full ${direct ? "bg-ok-soft text-ok-ink" : "bg-accent-soft text-accent-ink"}`}
            aria-hidden="true"
          >
            {direct ? <Keyboard className="size-5" /> : <Sparkles className="size-5" />}
          </span>
          <p className="min-w-0 leading-tight" role="status" aria-live="polite">
            <span className="block text-base font-extrabold text-ink">{direct ? "You have the call" : "The agent has the call"}</span>
            <span className="hidden truncate text-sm text-ink-2 sm:block">
              {direct ? "The agent is paused. Everything you type is spoken." : "Type to jump in, or take over completely."}
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => void switchMode()}
          disabled={!enabled || switching}
          className={`inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border-2 px-3.5 text-sm font-bold whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${
            direct
              ? "border-accent/50 bg-accent-soft text-accent-ink hover:border-accent"
              : "border-ok-line bg-ok-soft text-ok-ink hover:border-ok"
          }`}
        >
          {switching ? (
            <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
          ) : direct ? (
            <ArrowUpRight className="size-4" aria-hidden="true" />
          ) : (
            <Hand className="size-4" aria-hidden="true" />
          )}
          {direct ? "Hand back to agent" : "Take over & type"}
        </button>
      </div>

      <div className="-mx-4 mt-3 flex items-center gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden">
        {!introduced && (
          <QuickButton featured disabled={!enabled || sending} onClick={() => void say(introduction, false)}>
            Introduce me
          </QuickButton>
        )}
        {QUICK.map((line) => (
          <QuickButton key={line} disabled={!enabled || sending} onClick={() => void say(line, false)}>
            {line}
          </QuickButton>
        ))}
      </div>

      <div
        className={`mt-3 flex items-end gap-2 rounded-2xl border-2 bg-surface p-2 transition-colors focus-within:border-accent ${
          direct ? "border-ok-line" : "border-line-strong"
        }`}
      >
        <VoicePicker
          label="Your voice"
          voices={voices}
          value={voiceId}
          onChange={onVoice}
          tts={tts}
          sample={`Hi, this is ${user}. This is how I'll sound on the call.`}
          openUp
          inline
        />
        <label htmlFor="say-text" className="sr-only">
          Type what you want to say. It is spoken on the call in {voiceName}'s voice.
        </label>
        <textarea
          id="say-text"
          ref={box}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          maxLength={500}
          autoComplete="off"
          placeholder={
            enabled
              ? `Type something for ${voiceName} to say…`
              : "Get your first line ready…"
          }
          className="caption-text max-h-[180px] min-h-11 flex-1 resize-none overflow-y-auto bg-transparent px-2 py-1.5 text-ink [scrollbar-width:thin] placeholder:truncate placeholder:text-ink-3 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!enabled || sending || !text.trim()}
          className="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-xl bg-accent px-4 text-base font-bold text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? <Loader2 className="size-5 motion-safe:animate-spin" aria-hidden="true" /> : <Send className="size-5" aria-hidden="true" />}
          Speak
        </button>
      </div>

      <div className="mt-2 flex min-h-6 flex-wrap items-center justify-between gap-2 text-sm text-ink-2">
        {speaking ? (
          <span className="flex min-w-0 items-center gap-2 font-bold text-ok-ink">
            <SpeakingBars tone="ok" />
            <span className="truncate">
              {speaking.voice ?? voiceName} is saying “{speaking.text}”
            </span>
          </span>
        ) : (
          <span className="hidden sm:inline">
            Speaking as <b className="text-ink">{voiceName}</b> ·{" "}
            <kbd className="rounded border border-line-strong px-1 font-mono text-xs">Enter</kbd> to speak ·{" "}
            <kbd className="rounded border border-line-strong px-1 font-mono text-xs">Shift</kbd>+
            <kbd className="rounded border border-line-strong px-1 font-mono text-xs">Enter</kbd> for a new line
          </span>
        )}
        {queued > 0 && <span className="font-bold">{queued} more waiting</span>}
      </div>
      {error && (
        <p role="alert" className="mt-1 text-sm font-bold text-bad-ink">
          {error}
        </p>
      )}
    </form>
  );
}

function QuickButton(props: { children: string; onClick: () => void; disabled: boolean; featured?: boolean }) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      className={`min-h-9 shrink-0 cursor-pointer rounded-full border px-3.5 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${
        props.featured
          ? "border-ok-line bg-ok-soft text-ok-ink hover:border-ok"
          : "border-line bg-surface-2 text-ink-2 hover:border-accent hover:text-accent-ink"
      }`}
    >
      {props.children}
    </button>
  );
}
