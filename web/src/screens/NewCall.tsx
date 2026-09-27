import { Captions, Clapperboard, Eye, Keyboard, Play, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api } from "../api";
import { CallPreview, type Mode } from "../components/CallPreview";
import { ConstraintsEditor, FactsEditor, ModeCards, StepHeading, TemplatePicker } from "../components/TaskEditors";
import { TopBar } from "../components/TopBar";
import { VoicePicker } from "../components/VoicePicker";
import { useConfig, useVoices } from "../hooks/useVoices";
import { startDemo } from "../lib/demo";
import { loadDraft, saveDraft, taskFromForm } from "../lib/draft";
import { goToCall } from "../lib/nav";
import { PERSONA, TEMPLATES, type CallForm, type Template } from "../lib/templates";
import { btn, card, input, label } from "../lib/ui";
import type { AppConfig } from "../types";

type Required = "callee_name" | "to_number" | "user_name" | "goal";

const REQUIRED: Record<Required, string> = {
  callee_name: "Say who you're calling.",
  to_number: "Add the phone number to call.",
  user_name: "Add your name so the call can say who it's for.",
  goal: "Tell the agent what the call should get done.",
};

const DEMO_NUMBER = "(215) 555-0142";

export function NewCall() {
  const [form, setForm] = useState<CallForm>(loadDraft);
  const config = useConfig();
  const { voices } = useVoices();
  const [mode, setMode] = useState<Mode>("simulate");
  const [errors, setErrors] = useState<Partial<Record<Required, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const errorBox = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = "New call — CallProxy";
  }, []);

  useEffect(() => {
    if (config?.live_calls) setMode("live");
  }, [config?.live_calls]);

  useEffect(() => saveDraft(form), [form]);

  const update = <K extends keyof CallForm>(key: K, value: CallForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (key in errors) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const withTemplate = (f: CallForm, id: Template["id"]): CallForm => {
    const template = TEMPLATES.find((t) => t.id === id)!;
    return { ...f, ...structuredClone(template.form), user_name: f.user_name || PERSONA };
  };

  const applyTemplate = (id: Template["id"]) => {
    setForm((f) => withTemplate(f, id));
    setErrors({});
    // Land on the first thing a template can't fill in.
    requestAnimationFrame(() => document.getElementById("f-to_number")?.focus());
  };

  const start = async (f: CallForm, simulate: boolean, demo = false) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { call_id } = await api.createCall(taskFromForm(f), simulate);
      goToCall(call_id, { demo });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Couldn't place the call.");
      setSubmitting(false);
      requestAnimationFrame(() => errorBox.current?.focus());
    }
  };

  /** One click to a working demo: the dentist scenario, typed, as a practice call. */
  const tryPractice = (autoplay: boolean) => {
    setSubmitting(true);
    startDemo(false, autoplay).catch((err: Error) => {
      setSubmitError(err.message);
      setSubmitting(false);
    });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const found: Partial<Record<Required, string>> = {};
    for (const key of Object.keys(REQUIRED) as Required[]) {
      if (key === "goal" && form.mode === "direct") continue;
      if (!form[key].trim()) found[key] = REQUIRED[key];
    }
    setErrors(found);
    const firstInvalid = Object.keys(found)[0];
    if (firstInvalid) {
      document.getElementById(`f-${firstInvalid}`)?.focus();
      return;
    }
    void start(form, mode === "simulate");
  };

  const numberHint =
    mode === "live" && config?.allowed_numbers.length
      ? `Real calls only go to allowlisted numbers: ${config.allowed_numbers.join(", ")}`
      : undefined;
  const typing = form.mode === "direct";
  const myVoiceId = form.my_voice_id ?? config?.default_my_voice_id ?? null;
  const agentVoiceId = form.agent_voice_id ?? config?.default_agent_voice_id ?? null;
  const user = form.user_name.trim() || PERSONA;

  return (
    <div className="min-h-dvh pb-20">
      <TopBar>
        <ModeBadge config={config} />
      </TopBar>

      <main className="mx-auto max-w-6xl px-4 sm:px-6">
        {config?.static && (
          <p className="mt-2 rounded-2xl border border-accent/40 bg-accent-soft px-4 py-3 text-sm text-accent-ink">
            <b>Browser demo.</b> Practice calls run entirely in this page, and you'll hear them in your browser's voice. Real
            phone calls and ElevenLabs voices need the CallProxy backend:{" "}
            <a className="font-bold underline underline-offset-4" href="https://github.com/Mathew-O/Callproxy">
              see the repo
            </a>
            .
          </p>
        )}
        <section className="grid items-center gap-8 pt-6 pb-10 sm:pt-10 lg:grid-cols-[minmax(0,1fr)_26rem]">
          <div>
            <p className="text-sm font-bold tracking-wide text-accent-ink uppercase">Phone calls, without speaking</p>
            <h1 className="mt-2 text-5xl leading-[1.02] font-extrabold tracking-tight text-ink sm:text-7xl">
              Type it. <span className="text-accent-ink">We'll say it.</span>
            </h1>
            <p className="mt-5 max-w-2xl text-lg text-ink-2 sm:text-xl">
              You type, a natural ElevenLabs voice speaks for you on a real phone call, and their replies appear as live
              captions. Or hand the whole call to an AI agent that checks with you before it decides anything.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <button type="button" className={`${btn.primary} min-h-14 px-6 text-lg`} onClick={() => tryPractice(false)} disabled={submitting}>
                <Play className="size-5" aria-hidden="true" />
                Try a practice call
              </button>
              <button type="button" className={`${btn.secondary} min-h-14 px-6 text-lg`} onClick={() => tryPractice(true)} disabled={submitting}>
                <Clapperboard className="size-5" aria-hidden="true" />
                Watch the demo
              </button>
            </div>
            <p className="mt-3 text-sm text-ink-2">
              Practice calls ring a scripted receptionist, no phone or account needed. The demo types for you.{" "}
              <a href="#new-call" className="font-bold text-accent-ink underline underline-offset-4">
                Set up a real call
              </a>
            </p>
          </div>
          <HeroDemo />
        </section>

        <ul className="mb-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Pledge icon={<Keyboard className="size-5" />} title="Your words, a real voice">
            Pick from ElevenLabs voices. Quick phrases are one tap.
          </Pledge>
          <Pledge icon={<Captions className="size-5" />} title="Live captions">
            See what they say as they say it, and who's talking.
          </Pledge>
          <Pledge icon={<Sparkles className="size-5" />} title="An agent on standby">
            Hand off to an AI agent, or take the call back, any time.
          </Pledge>
          <Pledge icon={<Eye className="size-5" />} title="Honest and private">
            The agent says it's an AI and never reads out card numbers or passwords.
          </Pledge>
        </ul>

        <div id="new-call" className="scroll-mt-6">
          <TemplatePicker onPick={applyTemplate} />
        </div>

        <form onSubmit={submit} noValidate className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="space-y-6">
            <section className={`${card} p-5 sm:p-7`}>
              <StepHeading n={1} title="How do you want to talk?" />
              <ModeCards mode={form.mode} onChange={(m) => update("mode", m)} />
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <VoicePicker
                  label="Your voice (reads what you type)"
                  voices={voices}
                  value={myVoiceId}
                  onChange={(id) => update("my_voice_id", id)}
                  tts={config?.tts ?? false}
                  sample={`Hi, this is ${user}. I'm typing, and this is the voice people will hear.`}
                />
                <VoicePicker
                  label="Agent's voice"
                  voices={voices}
                  value={agentVoiceId}
                  onChange={(id) => update("agent_voice_id", id)}
                  tts={config?.tts ?? false}
                  sample={`Hi, I'm an AI assistant calling on behalf of ${user}.`}
                />
              </div>
            </section>

            <section className={`${card} p-5 sm:p-7`}>
              <StepHeading n={2} title="Who are we calling?" />
              <div className="grid gap-5 sm:grid-cols-2">
                <Field id="callee_name" label="Business or person" error={errors.callee_name}>
                  <input
                    id="f-callee_name"
                    className={input}
                    value={form.callee_name}
                    onChange={(e) => update("callee_name", e.target.value)}
                    placeholder="Dr. Rivera's office"
                    aria-invalid={!!errors.callee_name}
                    aria-describedby={errors.callee_name ? "e-callee_name" : undefined}
                  />
                </Field>
                <Field id="to_number" label="Phone number" error={errors.to_number} hint={numberHint}>
                  <input
                    id="f-to_number"
                    className={`${input} font-mono`}
                    type="tel"
                    inputMode="tel"
                    autoComplete="off"
                    value={form.to_number}
                    onChange={(e) => update("to_number", e.target.value)}
                    placeholder={DEMO_NUMBER}
                    aria-invalid={!!errors.to_number}
                    aria-describedby={
                      [errors.to_number && "e-to_number", numberHint && "h-to_number"].filter(Boolean).join(" ") ||
                      undefined
                    }
                  />
                </Field>
                <Field id="user_name" label="Your name" error={errors.user_name}>
                  <input
                    id="f-user_name"
                    className={input}
                    autoComplete="name"
                    value={form.user_name}
                    onChange={(e) => update("user_name", e.target.value)}
                    placeholder="Jordan Lee"
                    aria-invalid={!!errors.user_name}
                    aria-describedby={errors.user_name ? "e-user_name" : undefined}
                  />
                </Field>
              </div>
            </section>

            <section className={`${card} p-5 sm:p-7`}>
              <StepHeading
                n={3}
                title="What's the call about?"
                hint={typing ? "Optional when you're typing. The agent uses it if you hand the call over." : "In your own words. The agent works from this."}
              />
              <Field id="goal" label={typing ? "Goal (optional)" : "Goal"} error={errors.goal}>
                <textarea
                  id="f-goal"
                  className={`${input} min-h-24 resize-y`}
                  value={form.goal}
                  onChange={(e) => update("goal", e.target.value)}
                  placeholder="Book a teeth cleaning appointment."
                  aria-invalid={!!errors.goal}
                  aria-describedby={errors.goal ? "e-goal" : undefined}
                />
              </Field>
            </section>

            <section className={`${card} p-5 sm:p-7`}>
              <StepHeading
                n={4}
                title="What can the agent share?"
                hint={
                  typing
                    ? "Only used if you hand the call to the agent. It never gives out anything else."
                    : "The only personal details it may give out. For anything else, it asks you."
                }
              />
              <FactsEditor facts={form.facts} onChange={(facts) => update("facts", facts)} />
            </section>

            <section className={`${card} p-5 sm:p-7`}>
              <StepHeading n={5} title="Any limits for the agent?" hint="Time windows, budgets, things to avoid." />
              <ConstraintsEditor items={form.constraints} onChange={(items) => update("constraints", items)} />
            </section>
          </div>

          <CallPreview
            form={form}
            mode={mode}
            onMode={setMode}
            config={config}
            voices={voices}
            submitting={submitting}
            error={
              submitError && (
                <div
                  ref={errorBox}
                  tabIndex={-1}
                  role="alert"
                  className="mt-5 rounded-2xl border border-bad-line bg-bad-soft p-4 text-base font-bold text-bad-ink"
                >
                  {submitError}
                </div>
              )
            }
          />
        </form>

        <footer className="mt-12 text-center text-sm text-ink-2">
          Demoing? Print the{" "}
          <a href={`${import.meta.env.BASE_URL}cue-card.html`} target="_blank" className="font-bold text-accent-ink underline underline-offset-4">
            receptionist cue card
          </a>
          .
        </footer>
      </main>
    </div>
  );
}

/** A still of the product doing its thing: typed lines spoken, replies captioned. */
function HeroDemo() {
  return (
    <div className={`${card} hidden overflow-hidden lg:block`} aria-hidden="true">
      <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
        <span className="grid size-9 place-items-center rounded-full border-2 border-line bg-surface-2 text-sm font-extrabold text-ink">RO</span>
        <div className="leading-tight">
          <p className="font-extrabold text-ink">Dr. Rivera's office</p>
          <p className="text-sm text-ok-ink">● On the call · 0:42</p>
        </div>
      </div>
      <div className="space-y-3 px-5 py-4 text-[0.95rem]">
        <Bubble side="left" who="Dr. Rivera's office">
          Thanks for holding. What can I do for you?
        </Bubble>
        <Bubble side="right" who="You · River's voice" typed>
          I'd like to book a teeth cleaning, please.
        </Bubble>
        <Bubble side="left" who="Dr. Rivera's office">
          Sure! I have Thursday at 3 or Friday at 10.
        </Bubble>
        <Bubble side="right" who="You · River's voice" typed speaking>
          Thursday at 3 works great.
        </Bubble>
      </div>
      <div className="border-t border-line bg-surface-2 px-5 py-3.5">
        <div className="flex items-center gap-2 rounded-xl border-2 border-ok-line bg-surface px-3 py-2 text-ink-3">
          <Keyboard className="size-4" />
          Type what you want to say…
          <span className="ml-auto rounded-lg bg-accent px-2.5 py-1 text-sm font-bold text-on-accent">Speak</span>
        </div>
      </div>
    </div>
  );
}

function Bubble(props: { side: "left" | "right"; who: string; typed?: boolean; speaking?: boolean; children: ReactNode }) {
  const right = props.side === "right";
  return (
    <div className={`flex flex-col ${right ? "items-end" : "items-start"}`}>
      <span className="mb-1 px-1 text-xs font-bold text-ink-2">{props.who}</span>
      <span
        className={`max-w-[85%] rounded-2xl px-3.5 py-2 ${
          right ? "rounded-br-md border border-warn-line bg-warn-soft text-warn-ink" : "rounded-bl-md border border-line bg-surface text-ink"
        }`}
      >
        {props.children}
      </span>
      {props.speaking && <span className="mt-1 px-1 text-xs font-bold text-ok-ink">▮▮▮ Speaking now</span>}
    </div>
  );
}

function Pledge({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3 rounded-2xl border border-line bg-surface p-4 shadow-sm">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-ink" aria-hidden="true">
        {icon}
      </span>
      <span>
        <span className="block font-bold text-ink">{title}</span>
        <span className="mt-0.5 block text-sm text-ink-2">{children}</span>
      </span>
    </li>
  );
}

function ModeBadge({ config }: { config: AppConfig | null }) {
  if (!config) return null;
  const live = config.live_calls;
  return (
    <span
      className={`hidden items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-bold sm:inline-flex ${
        live ? "border-ok-line bg-ok-soft text-ok-ink" : "border-line bg-surface text-ink-2"
      }`}
    >
      <span className={`size-2 rounded-full ${live ? "bg-ok" : "bg-ink-3"}`} aria-hidden="true" />
      {live ? "Live calls ready" : "Practice mode"}
      {config.tts ? " · ElevenLabs voices" : ""}
    </span>
  );
}

function Field(props: { id: string; label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={`f-${props.id}`} className={label}>
        {props.label}
      </label>
      {props.children}
      {props.hint && (
        <p id={`h-${props.id}`} className="mt-1.5 text-sm text-ink-2">
          {props.hint}
        </p>
      )}
      {props.error && (
        <p id={`e-${props.id}`} className="mt-1.5 text-sm font-bold text-bad-ink">
          {props.error}
        </p>
      )}
    </div>
  );
}
