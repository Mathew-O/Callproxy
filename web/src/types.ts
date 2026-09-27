export type CallState =
  | "dialing"
  | "ringing"
  | "in_progress"
  | "waiting_on_user"
  | "wrapping_up"
  | "completed"
  | "no_answer"
  | "failed";

export const TERMINAL_STATES: CallState[] = ["completed", "no_answer", "failed"];
export const isTerminal = (state: CallState) => TERMINAL_STATES.includes(state);

export type Speaker = "agent" | "callee" | "user";
/** Who does the talking: the AI agent, or the user typing lines a voice reads out. */
export type CallMode = "agent" | "direct";
export type LineStatus = "queued" | "speaking" | "spoken" | "failed";

export interface CallTask {
  to_number: string;
  callee_name: string;
  user_name: string;
  goal: string;
  facts: Record<string, string>;
  constraints: string[];
  timezone?: string | null;
  mode: CallMode;
  my_voice_id?: string | null;
  agent_voice_id?: string | null;
}

export interface TranscriptTurn {
  id: string;
  speaker: Speaker;
  text: string;
  ts: number;
  final: boolean;
  via?: "typed" | "answer" | null;
  status?: LineStatus | null;
  voice?: string | null;
}

export interface Outcome {
  status: "success" | "partial" | "failed";
  summary: string;
  details: Record<string, string>;
}

export interface Question {
  question_id: string;
  question: string;
  options: string[];
  timeout_s: number;
  asked_at: number;
  timed_out: boolean;
}

export interface Speaking {
  agent: boolean;
  callee: boolean;
  you: boolean;
}

export type VoiceProvider = "simulator" | "openai" | "elevenlabs";

export interface Call {
  id: string;
  task: CallTask;
  state: CallState;
  mode: CallMode;
  detail: string | null;
  simulated: boolean;
  transcript: TranscriptTurn[];
  outcome: Outcome | null;
  pending_question: Question | null;
  withheld_facts: string[];
  created_at: number;
  answered_at: number | null;
  ended_at: number | null;
  response_gaps_ms: number[];
  speaking: Speaking;
  voice_provider: VoiceProvider;
  server_time: number;
}

export interface Voice {
  voice_id: string;
  name: string;
  gender: string;
  accent: string;
  description: string;
  preview_url: string | null;
  source: string;
}

export interface AppConfig {
  live_calls: boolean;
  voice_provider: "openai" | "elevenlabs";
  missing_settings: string[];
  allowed_numbers: string[];
  max_call_seconds: number;
  ask_user_timeout_s: number;
  tts: boolean;
  default_agent_voice_id: string;
  default_my_voice_id: string;
  /** The judge's number for the one-click live demo (masked), if one is set. */
  demo_number: string | null;
  /** True in the browser-only build: practice calls only. */
  static?: boolean;
}

/** A practice-call line for the browser to voice, so the room can hear the call. */
export interface SimSpeech {
  id: string;
  speaker: Speaker;
  text: string;
  voice_id: string;
}

export type FeedEvent =
  | { type: "snapshot"; data: Call }
  | { type: "status"; data: { state: CallState; detail: string | null } }
  | { type: "transcript"; data: TranscriptTurn }
  | { type: "ask_user"; data: Question }
  | { type: "question_closed"; data: { question_id: string } }
  | { type: "outcome"; data: Outcome }
  | { type: "activity"; data: Speaking }
  | { type: "mode"; data: { mode: CallMode } }
  | { type: "sim_speech"; data: SimSpeech }
  | { type: "ping"; data: Record<string, never> }
  | { type: "error"; data: { message: string } };
