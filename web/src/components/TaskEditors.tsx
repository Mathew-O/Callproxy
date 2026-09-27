import { CalendarClock, Check, CircleSlash, Keyboard, Pill, Plus, ShieldCheck, Sparkles, X } from "lucide-react";
import type { ReactNode } from "react";
import { looksSensitive } from "../lib/guardrails";
import { TEMPLATES, type CallForm, type Template } from "../lib/templates";
import { btn, input } from "../lib/ui";

const TEMPLATE_ICONS: Record<Template["id"], ReactNode> = {
  appointment: <CalendarClock className="size-6" aria-hidden="true" />,
  prescription: <Pill className="size-6" aria-hidden="true" />,
  cancel: <CircleSlash className="size-6" aria-hidden="true" />,
};

export function TemplatePicker({ onPick }: { onPick: (id: Template["id"]) => void }) {
  return (
    <section aria-labelledby="templates-title">
      <h2 id="templates-title" className="text-base font-bold text-ink-2">
        Start from a template
      </h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onPick(t.id)}
            className="group flex cursor-pointer items-start gap-3 rounded-2xl border border-line bg-surface p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-accent hover:shadow-card"
          >
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-ink transition-colors group-hover:bg-accent group-hover:text-on-accent">
              {TEMPLATE_ICONS[t.id]}
            </span>
            <span>
              <span className="block text-base font-bold text-ink">{t.label}</span>
              <span className="mt-0.5 block text-sm text-ink-2">{t.blurb}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function StepHeading({ n, title, hint }: { n: number; title: string; hint?: string }) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <span
        className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft font-mono text-sm font-bold text-accent-ink"
        aria-hidden="true"
      >
        {n}
      </span>
      <div>
        <h2 className="text-xl font-extrabold tracking-tight text-ink">{title}</h2>
        {hint && <p className="mt-0.5 text-base text-ink-2">{hint}</p>}
      </div>
    </div>
  );
}

export function FactsEditor({ facts, onChange }: { facts: CallForm["facts"]; onChange: (f: CallForm["facts"]) => void }) {
  const set = (i: number, field: "key" | "value", value: string) =>
    onChange(facts.map((f, j) => (j === i ? { ...f, [field]: value } : f)));
  return (
    <fieldset>
      <legend className="sr-only">Facts the agent may share</legend>
      <ul className="space-y-3">
        {facts.map((fact, i) => {
          const sensitive = !!(fact.key || fact.value) && looksSensitive(fact.key, fact.value);
          const noteId = `fact-note-${i}`;
          return (
            <li key={i}>
              <div className="flex flex-wrap gap-2 sm:flex-nowrap">
                <input
                  className={`${input} sm:w-2/5`}
                  aria-label={`Fact ${i + 1} name`}
                  placeholder="Date of birth"
                  value={fact.key}
                  onChange={(e) => set(i, "key", e.target.value)}
                  aria-describedby={sensitive ? noteId : undefined}
                />
                <input
                  className={`${input} min-w-0 flex-1`}
                  aria-label={`Fact ${i + 1} value`}
                  placeholder="March 14, 2005"
                  value={fact.value}
                  onChange={(e) => set(i, "value", e.target.value)}
                  aria-describedby={sensitive ? noteId : undefined}
                />
                <button
                  type="button"
                  className={btn.ghost}
                  aria-label={`Remove fact ${i + 1}${fact.key ? ` (${fact.key})` : ""}`}
                  onClick={() => onChange(facts.length > 1 ? facts.filter((_, j) => j !== i) : [{ key: "", value: "" }])}
                >
                  <X className="size-5" aria-hidden="true" />
                </button>
              </div>
              {sensitive && (
                <p id={noteId} className="mt-1.5 flex items-center gap-1.5 text-sm font-bold text-warn-ink">
                  <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
                  Looks like payment, ID, or login info. The agent won't say it on the call.
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <button type="button" className={`${btn.ghost} mt-2`} onClick={() => onChange([...facts, { key: "", value: "" }])}>
        <Plus className="size-5" aria-hidden="true" />
        Add a fact
      </button>
    </fieldset>
  );
}

export function ConstraintsEditor({ items, onChange }: { items: string[]; onChange: (items: string[]) => void }) {
  return (
    <fieldset>
      <legend className="sr-only">Constraints</legend>
      <ul className="space-y-3">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2">
            <input
              className={`${input} min-w-0 flex-1`}
              aria-label={`Constraint ${i + 1}`}
              placeholder="I'm free Tuesday and Thursday afternoons."
              value={item}
              onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
            />
            <button
              type="button"
              className={btn.ghost}
              aria-label={`Remove constraint ${i + 1}`}
              onClick={() => onChange(items.length > 1 ? items.filter((_, j) => j !== i) : [""])}
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className={`${btn.ghost} mt-2`} onClick={() => onChange([...items, ""])}>
        <Plus className="size-5" aria-hidden="true" />
        Add a limit
      </button>
    </fieldset>
  );
}

export function ModeCards({ mode, onChange }: { mode: "direct" | "agent"; onChange: (mode: "direct" | "agent") => void }) {
  const options = [
    {
      value: "direct" as const,
      icon: <Keyboard className="size-6" aria-hidden="true" />,
      title: "I'll type",
      body: "You type, a natural ElevenLabs voice says it on the call, and their replies show up as captions.",
    },
    {
      value: "agent" as const,
      icon: <Sparkles className="size-6" aria-hidden="true" />,
      title: "Let the agent talk",
      body: "An AI agent handles the conversation and checks with you before it decides anything.",
    },
  ];
  return (
    <fieldset>
      <legend className="sr-only">How do you want to talk?</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {options.map((o) => {
          const checked = mode === o.value;
          return (
            <label
              key={o.value}
              className={`relative flex cursor-pointer flex-col gap-2 rounded-2xl border-2 p-4 transition-colors has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
                checked ? "border-accent bg-accent-soft" : "border-line bg-surface hover:border-line-strong"
              }`}
            >
              <input type="radio" name="talk-mode" className="sr-only" checked={checked} onChange={() => onChange(o.value)} />
              <span className="flex items-center gap-3">
                <span
                  className={`grid size-11 place-items-center rounded-xl ${checked ? "bg-accent text-on-accent" : "bg-surface-2 text-accent-ink"}`}
                >
                  {o.icon}
                </span>
                <span className="text-lg font-extrabold text-ink">{o.title}</span>
                {checked && <Check className="ml-auto size-5 text-accent-ink" aria-hidden="true" />}
              </span>
              <span className="text-base text-ink-2">{o.body}</span>
            </label>
          );
        })}
      </div>
      <p className="mt-3 text-sm text-ink-2">Either way, you can switch mid-call: take over and type, or hand it to the agent.</p>
    </fieldset>
  );
}
