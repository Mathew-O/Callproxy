import type { Call, FeedEvent } from "../types";

export interface FeedState {
  call: Call | null;
  /** Seconds to add to the browser clock to get the server clock. */
  clockOffset: number;
  error: string | null;
}

export const initialFeed: FeedState = { call: null, clockOffset: 0, error: null };

const nowSeconds = () => Date.now() / 1000;

export function feedReducer(state: FeedState, event: FeedEvent): FeedState {
  if (event.type === "snapshot") {
    return { call: event.data, clockOffset: event.data.server_time - nowSeconds(), error: null };
  }
  if (event.type === "error") return { ...state, error: event.data.message };
  const call = state.call;
  if (!call) return state;

  switch (event.type) {
    case "status": {
      const answeredAt =
        call.answered_at ?? (event.data.state === "in_progress" ? nowSeconds() + state.clockOffset : null);
      return { ...state, call: { ...call, state: event.data.state, detail: event.data.detail, answered_at: answeredAt } };
    }
    case "transcript": {
      const turn = event.data;
      const idx = call.transcript.findIndex((t) => t.id === turn.id);
      let transcript = call.transcript;
      if (turn.final && !turn.text.trim()) {
        transcript = idx >= 0 ? transcript.filter((t) => t.id !== turn.id) : transcript;
      } else if (idx >= 0) {
        // Keep the original timestamp so the turn keeps its place in the conversation.
        transcript = transcript.map((t, i) => (i === idx ? { ...turn, ts: t.ts } : t));
      } else {
        transcript = [...transcript, turn];
      }
      return { ...state, call: { ...call, transcript } };
    }
    case "ask_user":
      return { ...state, call: { ...call, pending_question: event.data } };
    case "question_closed":
      return call.pending_question?.question_id === event.data.question_id
        ? { ...state, call: { ...call, pending_question: null } }
        : state;
    case "outcome":
      return { ...state, call: { ...call, outcome: event.data } };
    case "activity":
      return { ...state, call: { ...call, speaking: event.data } };
    case "mode":
      return { ...state, call: { ...call, mode: event.data.mode } };
    default:
      return state;
  }
}
