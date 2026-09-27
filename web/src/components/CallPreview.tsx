import { Captions, FlaskConical, MessageCircleQuestion, Phone, ShieldCheck, ShieldOff, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { looksSensitive } from "../lib/guardrails";
import type { CallForm } from "../lib/templates";
import { btn, card } from "../lib/ui";
import type { AppConfig, Voice } from "../types";
import { Avatar } from "./Avatar";

export type Mode = "live" | "simulate";

interface Props {
  form: CallForm;
  mode: Mode;
  onMode: (mode: Mode) => void;
  config: AppConfig | null;
  voices: Voice[];
  submitting: boolean;
  error: ReactNode;
}

const PROVIDER_NAMES = { elevenlabs: "ElevenLabs", openai: "OpenAI Realtime" };

/**
 * What will actually happen on this call, before anything is dialed: how it opens, whose
 * voice speaks, what may be shared and what's kept back.
 */
export function CallPreview({ form, mode, onMode, config, voices, submitting, error }: Props) {
  const facts = form.facts.filter((f) => f.key.trim() && f.value.trim());
  const shareable = facts.filter((f) => !looksSensitive(f.key, f.value));
  const withheld = facts.filter((f) => looksSensitive(f.key, f.value));
  const limits = form.constraints.filter((c) => c.trim()).length;
  const user = form.user_name.trim() || "[your name]";
  const live = config?.live_calls ?? false;
  const typing = form.mode === "direct";
  const name = (id: string | null, fallback: string | undefined) =>
    voices.find((v) => v.voice_id === (id ?? fallback))?.name ?? "…";
  const myVoice = name(form.my_voice_id, config?.default_my_voice_id);
  const agentVoice = name(form.agent_voice_id, config?.default_agent_voice_id);

  return (
    <aside className={`${card} p-5 sm:p-6 lg:sticky lg:top-6`} aria-labelledby="preview-title">
      <h2 id="preview-title" className="text-sm font-bold tracking-wide text-accent-ink uppercase">
        Call preview
      </h2>
      <div className="mt-4 flex items-center gap-3">
        <Avatar name={form.callee_name || "?"} kind="callee" />
        <div className="min-w-0">
          <p className="truncate text-lg font-extrabold text-ink">{form.callee_name.trim() || "Who you're calling"}</p>
          <p className="font-mono text-sm text-ink-2">{form.to_number.trim() || "No number yet"}</p>
        </div>
      </div>

      {typing ? (
        <>
          <p className="mt-5 text-sm font-bold text-ink-2">You can open with</p>
          <blockquote className="mt-2 rounded-3xl rounded-br-md border border-ok-line bg-ok-soft px-4 py-3 text-base text-ok-ink">
            “Hi, this is {user}. I'm typing, and a voice is reading my words out loud…”
            <span className="mt-1.5 block text-sm font-bold">Read aloud by {myVoice} · ElevenLabs</span>
          </blockquote>
        </>
      ) : (
        <>
          <p className="mt-5 text-sm font-bold text-ink-2">The agent opens with</p>
          <blockquote className="mt-2 rounded-3xl rounded-br-md bg-accent px-4 py-3 text-base text-on-accent">
            “Hi, I'm an AI assistant calling on behalf of {user}.”
            {form.goal.trim() && <span className="mt-1.5 block">Then it explains: {form.goal.trim()}</span>}
            <span className="mt-1.5 block text-sm font-bold">Voice: {agentVoice} · ElevenLabs</span>
          </blockquote>
        </>
      )}

      <dl className="mt-5 space-y-4 text-sm">
        {typing ? (
          <>
            <Row icon={<Captions className="size-4" />} title="Their side">
              <span className="text-ink-2">shows up as live captions while they talk.</span>
            </Row>
            <Row icon={<Sparkles className="size-4" />} title="Need a hand?">
              <span className="text-ink-2">
                Hand the call to the AI agent any time. It picks up from what's been said
                {shareable.length > 0 &&
                  ` and can share your ${shareable.length} listed ${shareable.length === 1 ? "fact" : "facts"}`}
                .
              </span>
            </Row>
          </>
        ) : (
          <>
            <Row icon={<ShieldCheck className="size-4" />} title="It can share">
              {shareable.length ? (
                <ul className="flex flex-wrap gap-1.5">
                  {shareable.map((f, i) => (
                    <li key={`${f.key}-${i}`} className="rounded-full bg-ok-soft px-2.5 py-1 font-bold text-ok-ink">
                      {f.key}
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-ink-2">Nothing. It will ask you for any detail.</span>
              )}
            </Row>
            <Row icon={<MessageCircleQuestion className="size-4" />} title="It asks you before">
              <span className="text-ink-2">
                picking between options, or sharing anything not listed
                {limits > 0 && `, and it sticks to your ${limits} ${limits === 1 ? "limit" : "limits"}`}.
              </span>
            </Row>
          </>
        )}
        {withheld.length > 0 && (
          <Row icon={<ShieldOff className="size-4" />} title="Never said on the call">
            <ul className="flex flex-wrap gap-1.5">
              {withheld.map((f, i) => (
                <li key={`${f.key}-${i}`} className="rounded-full bg-bad-soft px-2.5 py-1 font-bold text-bad-ink">
                  {f.key}
                </li>
              ))}
            </ul>
          </Row>
        )}
      </dl>

      <fieldset className="mt-6">
        <legend className="mb-2 text-sm font-bold text-ink-2">How to call</legend>
        <div className="grid grid-cols-2 gap-2 rounded-2xl bg-surface-2 p-1.5">
          <ModeOption
            checked={mode === "live"}
            disabled={!live}
            onSelect={() => onMode("live")}
            icon={<Phone className="size-4" aria-hidden="true" />}
            title="Real call"
          />
          <ModeOption
            checked={mode === "simulate"}
            onSelect={() => onMode("simulate")}
            icon={<FlaskConical className="size-4" aria-hidden="true" />}
            title="Practice"
          />
        </div>
        <p className="mt-2 text-sm text-ink-2">
          {mode === "simulate"
            ? `A practice receptionist answers and reacts to what you say. You'll hear both sides${config?.tts ? " in ElevenLabs voices" : ""}.`
            : `Dials through Twilio. Agent by ${PROVIDER_NAMES[config?.voice_provider ?? "elevenlabs"]}.`}
          {!live && config && (config.static ? " Real calls need the CallProxy backend." : ` Real calls need ${config.missing_settings.join(", ")} in .env.`)}
        </p>
      </fieldset>

      {error}

      <button type="submit" className={`${btn.primary} mt-5 min-h-14 w-full text-lg`} disabled={submitting}>
        <Phone className="size-5" aria-hidden="true" />
        {submitting ? "Placing call…" : mode === "live" ? "Place the call" : "Start practice call"}
      </button>
      <p className="mt-3 text-center text-sm text-ink-2">Calls are capped at 5 minutes. You can hang up any time.</p>
    </aside>
  );
}

function Row({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div>
      <dt className="mb-1.5 flex items-center gap-1.5 font-bold text-ink">
        <span className="text-accent-ink" aria-hidden="true">
          {icon}
        </span>
        {title}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

function ModeOption(props: { checked: boolean; disabled?: boolean; onSelect: () => void; icon: ReactNode; title: string }) {
  return (
    <label
      className={`flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl px-3 text-base font-bold transition-colors has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
        props.checked ? "bg-surface text-ink shadow-sm" : "text-ink-2 hover:text-ink"
      } ${props.disabled ? "cursor-not-allowed opacity-55" : ""}`}
    >
      <input
        type="radio"
        name="mode"
        className="sr-only"
        checked={props.checked}
        disabled={props.disabled}
        onChange={props.onSelect}
      />
      {props.icon}
      {props.title}
    </label>
  );
}
