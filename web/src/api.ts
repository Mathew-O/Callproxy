import { localEngine } from "./local/engine";
import { DEFAULT_AGENT_VOICE, DEFAULT_MY_VOICE, LOCAL_VOICES } from "./local/voices";
import type { AppConfig, Call, CallMode, CallTask, Voice } from "./types";

/** The static build (the GitHub Pages link) runs practice calls in the browser, no backend. */
export const STATIC = import.meta.env.VITE_STATIC === "1";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    throw new ApiError("Can't reach the CallProxy server. Is the backend running?", 0);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(errorMessage(body) ?? `Request failed (${res.status})`, res.status);
  }
  return body as T;
}

function errorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object" || !("detail" in body)) return null;
  const detail = (body as { detail: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    // FastAPI validation errors: [{loc: [..., "field"], msg}]
    return detail
      .map((d: { loc?: unknown[]; msg?: string }) => `${String(d.loc?.at(-1) ?? "field")}: ${d.msg ?? "invalid"}`)
      .join("; ");
  }
  return null;
}

const post = <T>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) });

const serverApi = {
  config: () => request<AppConfig>("/config"),
  createCall: (task: CallTask, simulate: boolean) =>
    post<{ call_id: string; withheld_facts: string[] }>("/calls", { ...task, simulate }),
  getCall: (id: string) => request<Call>(`/calls/${id}`),
  reply: (id: string, questionId: string, answer: string) =>
    post<{ ok: boolean }>(`/calls/${id}/reply`, { question_id: questionId, answer }),
  say: (id: string, text: string, voiceId?: string | null) =>
    post<{ line_id: string }>(`/calls/${id}/say`, { text, voice_id: voiceId ?? null }),
  setMode: (id: string, mode: CallMode) => post<{ mode: CallMode }>(`/calls/${id}/mode`, { mode }),
  voices: () => request<{ voices: Voice[]; from_account: boolean }>("/voices"),
  /** An mp3 of the text in an ElevenLabs voice. Fails without a key; callers fall back. */
  tts: async (text: string, voiceId: string): Promise<Blob> => {
    const res = await fetch("/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice_id: voiceId }),
    });
    if (!res.ok) throw new ApiError(`Voice unavailable (${res.status})`, res.status);
    return res.blob();
  },
  hangup: (id: string) => post<{ ok: boolean }>(`/calls/${id}/hangup`, {}),
  /** The one-click stage demo: practice, or a real call to the judge's phone. */
  demoCall: (live: boolean) => post<{ call_id: string; withheld_facts: string[] }>("/demo/call", { live }),
};

const LOCAL_CONFIG: AppConfig = {
  live_calls: false,
  voice_provider: "elevenlabs",
  missing_settings: [],
  allowed_numbers: [],
  max_call_seconds: 300,
  ask_user_timeout_s: 30,
  tts: false,
  default_agent_voice_id: DEFAULT_AGENT_VOICE,
  default_my_voice_id: DEFAULT_MY_VOICE,
  demo_number: null,
  static: true,
};

const guard = <T>(fn: () => T): Promise<T> => {
  try {
    return Promise.resolve(fn());
  } catch (e) {
    return Promise.reject(new ApiError(e instanceof Error ? e.message : String(e), 409));
  }
};

const localApi: typeof serverApi = {
  config: () => Promise.resolve(LOCAL_CONFIG),
  createCall: (task: CallTask) => guard(() => ({ call_id: localEngine.create(task), withheld_facts: [] })),
  getCall: (id: string) => guard(() => localEngine.get(id).snapshot()),
  reply: (id: string, questionId: string, answer: string) =>
    guard(() => {
      if (!localEngine.get(id).reply(questionId, answer)) throw new Error("That question is no longer open.");
      return { ok: true };
    }),
  say: (id: string, text: string, voiceId?: string | null) =>
    guard(() => ({ line_id: localEngine.get(id).say(text, voiceId ?? null) })),
  setMode: (id: string, mode: CallMode) =>
    guard(() => {
      localEngine.get(id).setMode(mode);
      return { mode };
    }),
  voices: () => Promise.resolve({ voices: LOCAL_VOICES, from_account: false }),
  tts: () => Promise.reject(new ApiError("No ElevenLabs key in the browser demo", 503)),
  hangup: (id: string) =>
    guard(() => {
      localEngine.get(id).hangup();
      return { ok: true };
    }),
  demoCall: () => Promise.reject(new ApiError("Live calls need the CallProxy backend.", 400)),
};

export const api = STATIC ? localApi : serverApi;

export function callSocketUrl(id: string): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws/calls/${id}`;
}
