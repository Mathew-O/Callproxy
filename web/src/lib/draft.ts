import type { CallTask } from "../types";
import { EMPTY_FORM, type CallForm } from "./templates";

const KEY = "callproxy:draft";

// Storage can throw (private windows, blocked site data); the form works without it.
export function loadDraft(): CallForm {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...EMPTY_FORM, ...(JSON.parse(raw) as Partial<CallForm>) };
  } catch {
    /* ignore */
  }
  return EMPTY_FORM;
}

export function saveDraft(form: CallForm): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(form));
  } catch {
    /* ignore */
  }
}

export function formFromTask(task: CallTask): CallForm {
  const facts = Object.entries(task.facts).map(([key, value]) => ({ key, value }));
  return {
    callee_name: task.callee_name,
    to_number: task.to_number,
    user_name: task.user_name,
    goal: task.goal,
    facts: facts.length ? facts : [{ key: "", value: "" }],
    constraints: task.constraints.length ? task.constraints : [""],
    mode: task.mode,
    my_voice_id: task.my_voice_id ?? null,
    agent_voice_id: task.agent_voice_id ?? null,
  };
}

export function taskFromForm(form: CallForm): CallTask {
  const facts: Record<string, string> = {};
  for (const { key, value } of form.facts) {
    if (key.trim() && value.trim()) facts[key.trim()] = value.trim();
  }
  let timezone: string | null = null;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    /* ignore */
  }
  return {
    callee_name: form.callee_name.trim(),
    to_number: form.to_number.trim(),
    user_name: form.user_name.trim(),
    goal: form.goal.trim(),
    facts,
    constraints: form.constraints.map((c) => c.trim()).filter(Boolean),
    timezone,
    mode: form.mode,
    my_voice_id: form.my_voice_id,
    agent_voice_id: form.agent_voice_id,
  };
}
