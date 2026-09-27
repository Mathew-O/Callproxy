import type { CallMode, CallState, Speaking } from "../types";
import { Avatar, SpeakingBars } from "./Avatar";

interface Props {
  calleeName: string;
  speaking: Speaking;
  state: CallState;
  mode: CallMode;
  myVoiceName: string;
}

/**
 * Who is talking right now. Hearing callers get this for free; for a Deaf user it's the
 * difference between "they're answering" and "the line went quiet".
 */
export function Participants({ calleeName, speaking, state, mode, myVoiceName }: Props) {
  const connected = !["dialing", "ringing"].includes(state);
  const idle = connected ? "Listening" : "Waiting";
  return (
    <div role="group" className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap" aria-label="Who's talking">
      {mode === "direct" ? (
        <Chip
          name={`You · ${myVoiceName}`}
          short="You"
          kind="you"
          speaking={speaking.you}
          status={speaking.you ? "Speaking" : "Your turn to type"}
        />
      ) : (
        <Chip
          name="CallProxy agent"
          short="AI agent"
          kind="agent"
          speaking={speaking.agent || speaking.you}
          status={speaking.you ? `Saying your line` : speaking.agent ? "Speaking" : idle}
        />
      )}
      <Chip
        name={calleeName}
        kind="callee"
        speaking={speaking.callee}
        status={speaking.callee ? "Speaking" : connected ? "Listening" : state === "ringing" ? "Ringing" : "Dialing"}
      />
    </div>
  );
}

function Chip(props: { name: string; short?: string; kind: "agent" | "callee" | "you"; speaking: boolean; status: string }) {
  const active = props.speaking;
  const tone = props.kind === "agent" ? "accent" : "ok";
  return (
    <div
      className={`flex min-w-0 items-center gap-2.5 rounded-2xl border py-1.5 pr-3.5 pl-1.5 transition-colors ${
        active ? (tone === "accent" ? "border-accent/50 bg-accent-soft" : "border-ok-line bg-ok-soft") : "border-line bg-surface"
      }`}
    >
      <Avatar name={props.kind === "you" ? "You" : props.name} kind={props.kind === "agent" ? "agent" : "callee"} speaking={active} />
      <span className="min-w-0 leading-tight">
        <span className="block max-w-[14rem] truncate text-sm font-bold text-ink">
          {props.short ? (
            <>
              <span className="sm:hidden">{props.short}</span>
              <span className="hidden sm:inline">{props.name}</span>
            </>
          ) : (
            props.name
          )}
        </span>
        <span className={`flex items-center gap-1.5 text-sm ${active ? (tone === "accent" ? "text-accent-ink" : "text-ok-ink") : "text-ink-2"}`}>
          {active && <SpeakingBars tone={tone} />}
          {props.status}
        </span>
      </span>
    </div>
  );
}
