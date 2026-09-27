import { Clapperboard, Keyboard, Loader2, PhoneCall, PhoneOff, ShieldCheck, Volume2, VolumeX, WifiOff } from "lucide-react";
import { useCallback, useState } from "react";
import { api } from "../api";
import { AlertFlash } from "../components/AlertFlash";
import { Avatar } from "../components/Avatar";
import { CallProgress } from "../components/CallProgress";
import { CallTimer } from "../components/CallTimer";
import { Composer } from "../components/Composer";
import { DecisionCard } from "../components/DecisionCard";
import { Participants } from "../components/Participants";
import { SpeakingOrb } from "../components/SpeakingOrb";
import { StatusPill } from "../components/StatusPill";
import { CaptionControl } from "../components/TopBar";
import { Transcript } from "../components/Transcript";
import type { Connection } from "../hooks/useCallFeed";
import { useDemoDriver } from "../hooks/useDemoDriver";
import { useVoices } from "../hooks/useVoices";
import { isDemo } from "../lib/nav";
import { introductionFor } from "../lib/phrases";
import { btn } from "../lib/ui";
import type { AppConfig, Call } from "../types";

interface Props {
  call: Call;
  clockOffset: number;
  connection: Connection;
  config: AppConfig | null;
  audio: { enabled: boolean; setEnabled: (on: boolean) => void };
}

const CAN_SPEAK = new Set(["in_progress", "waiting_on_user", "wrapping_up"]);
const VIA = { simulator: "Practice call", openai: "Live · OpenAI agent", elevenlabs: "Live · ElevenLabs agent" };

export function LiveCall({ call, clockOffset, connection, config, audio }: Props) {
  const [hangingUp, setHangingUp] = useState(false);
  const [chosenVoice, setChosenVoice] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [autoplay, setAutoplay] = useState(() => isDemo() && call.simulated);
  const { voices } = useVoices();
  const { task, state } = call;
  const question = call.pending_question;
  const myVoiceId = chosenVoice ?? task.my_voice_id ?? config?.default_my_voice_id ?? voices[0]?.voice_id ?? null;
  const myVoiceName = voices.find((v) => v.voice_id === myVoiceId)?.name ?? "your voice";
  const deciding = !!question && !question.timed_out;
  const calleePartial = [...call.transcript].reverse().find((t) => t.speaker === "callee" && !t.final)?.text ?? "";

  const hangUp = async () => {
    setHangingUp(true);
    try {
      await api.hangup(call.id);
    } catch {
      setHangingUp(false);
    }
  };

  const setMode = useCallback(async (mode: Call["mode"]) => {
    await api.setMode(call.id, mode);
  }, [call.id]);
  const say = useCallback(async (text: string) => {
    await api.say(call.id, text, myVoiceId);
  }, [call.id, myVoiceId]);
  const answer = useCallback(async (questionId: string, text: string) => {
    await api.reply(call.id, questionId, text);
  }, [call.id]);

  useDemoDriver({ call, active: autoplay, introduction: introductionFor(task.user_name), setDraft, say, setMode, answer });

  return (
    <div className="flex h-dvh flex-col [@media(max-height:34rem)]:h-auto [@media(max-height:34rem)]:min-h-dvh">
      <AlertFlash trigger={deciding ? question!.question_id : null} />

      <header className="sticky top-0 z-20 shrink-0 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 pt-3 sm:gap-4 sm:px-6">
          <Avatar name={task.callee_name} kind="callee" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-extrabold tracking-tight text-ink sm:text-2xl">{task.callee_name}</h1>
            <p className="truncate text-sm font-bold text-ink-2">
              For {task.user_name} · {VIA[call.voice_provider] ?? "Live call"}
            </p>
          </div>
          <div className="hidden items-center gap-3 md:flex">
            <StatusPill state={state} />
            <CallTimer answeredAt={call.answered_at} endedAt={call.ended_at} clockOffset={clockOffset} />
            {call.simulated && <AudioToggle audio={audio} />}
            <CaptionControl />
          </div>
          <button className={btn.danger} onClick={hangUp} disabled={hangingUp}>
            <PhoneOff className="size-5" aria-hidden="true" />
            {hangingUp ? "Hanging up…" : "Hang up"}
          </button>
        </div>
        {/* Phones: status and timer get their own row instead of crowding the name. */}
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 pt-2 md:hidden">
          <StatusPill state={state} />
          <CallTimer answeredAt={call.answered_at} endedAt={call.ended_at} clockOffset={clockOffset} />
          {call.simulated && (
            <div className="ml-auto">
              <AudioToggle audio={audio} />
            </div>
          )}
        </div>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Participants
            calleeName={task.callee_name}
            speaking={call.speaking}
            state={state}
            mode={call.mode}
            myVoiceName={myVoiceName}
          />
          <div className="hidden xl:block">
            <CallProgress state={state} />
          </div>
        </div>
        {autoplay && (
          <p className="flex items-center justify-center gap-3 bg-accent px-4 py-2 text-sm font-bold text-on-accent">
            <Clapperboard className="size-4" aria-hidden="true" />
            Autoplay demo: the app is typing for Jordan
            <button
              type="button"
              onClick={() => setAutoplay(false)}
              className="cursor-pointer rounded-lg bg-surface px-2.5 py-1 text-ink hover:bg-surface-2"
            >
              Take the wheel
            </button>
          </p>
        )}
        <Banners call={call} connection={connection} />
      </header>

      <main className="relative flex min-h-0 flex-1 flex-col">
        <SpeakingOrb variant="float" speaking={call.speaking.callee} name={task.callee_name} partial={calleePartial} />
        <Transcript
          live
          turns={call.transcript}
          calleeName={task.callee_name}
          startedAt={call.answered_at}
          empty={<EmptyState call={call} />}
          pinKey={`${question?.question_id ?? ""}${call.mode}`}
          after={<SpeakingOrb variant="inline" speaking={call.speaking.callee} name={task.callee_name} partial={calleePartial} />}
        />
        {question && (
          <DecisionCard
            question={question}
            calleeName={task.callee_name}
            clockOffset={clockOffset}
            onAnswer={async (answer) => {
              await api.reply(call.id, question.question_id, answer);
            }}
            onTakeOver={() => setMode("direct")}
          />
        )}
      </main>

      {/* While a decision is open, the card has the screen; its own box covers typing. */}
      {!deciding && (
        <footer className="shrink-0 border-t border-line bg-surface shadow-[0_-12px_32px_-20px_rgb(0_0_0/0.35)]">
          <Composer
            call={call}
            voices={voices}
            voiceId={myVoiceId}
            onVoice={setChosenVoice}
            tts={config?.tts ?? false}
            enabled={CAN_SPEAK.has(state)}
            onSay={say}
            onMode={setMode}
            draft={draft}
            onDraft={setDraft}
          />
        </footer>
      )}
    </div>
  );
}

function AudioToggle({ audio }: { audio: Props["audio"] }) {
  return (
    <button
      type="button"
      aria-pressed={audio.enabled}
      onClick={() => audio.setEnabled(!audio.enabled)}
      title={audio.enabled ? "Mute the practice call" : "Hear the practice call"}
      className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-xl border border-line bg-surface px-2.5 text-sm font-bold text-ink-2 hover:text-ink aria-pressed:border-accent/50 aria-pressed:bg-accent-soft aria-pressed:text-accent-ink"
    >
      {audio.enabled ? <Volume2 className="size-4" aria-hidden="true" /> : <VolumeX className="size-4" aria-hidden="true" />}
      Call audio
    </button>
  );
}

function Banners({ call, connection }: { call: Call; connection: Connection }) {
  return (
    <>
      {connection === "reconnecting" && (
        <p role="status" className="flex items-center justify-center gap-2 bg-warn-soft px-4 py-2 font-bold text-warn-ink">
          <WifiOff className="size-5" aria-hidden="true" />
          Connection dropped. Reconnecting… the call is still going.
        </p>
      )}
      {call.state === "wrapping_up" && call.mode === "agent" && (
        <p className="flex items-center justify-center gap-2 bg-accent-soft px-4 py-2 font-bold text-accent-ink">
          <Loader2 className="size-5 motion-safe:animate-spin" aria-hidden="true" />
          Confirming details with {call.task.callee_name}…
        </p>
      )}
      {call.withheld_facts.length > 0 && call.mode === "agent" && (
        <p className="flex items-center justify-center gap-2 bg-surface-2 px-4 py-2 text-sm text-ink-2">
          <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
          For your safety the agent won't share: {call.withheld_facts.join(", ")}.
        </p>
      )}
    </>
  );
}

function EmptyState({ call }: { call: Call }) {
  const name = call.task.callee_name;
  const ringing = call.state === "ringing";
  const dialing = call.state === "dialing";
  const direct = call.mode === "direct";
  return (
    <div className="flex flex-col items-center px-4 pt-12 text-center sm:pt-16">
      <span className="relative grid size-28 place-items-center" aria-hidden="true">
        {(ringing || dialing) && (
          <>
            <span className="absolute inset-0 rounded-full bg-accent/25 motion-safe:animate-ping" />
            <span className="absolute inset-3 rounded-full bg-accent/20" />
          </>
        )}
        <span className="relative grid size-20 place-items-center rounded-full bg-accent text-on-accent shadow-card">
          {dialing ? <Loader2 className="size-9 motion-safe:animate-spin" /> : direct && !ringing ? <Keyboard className="size-9" /> : <PhoneCall className="size-9" />}
        </span>
      </span>
      <p className="mt-6 text-3xl font-extrabold tracking-tight text-ink">
        {dialing ? `Calling ${name}` : ringing ? "Ringing…" : direct ? "You're connected" : "Connected"}
      </p>
      <p className="mt-2 max-w-md text-lg text-ink-2">
        {dialing
          ? "Placing the call."
          : ringing
            ? `Waiting for ${name} to pick up.${direct ? " Get your first line ready below." : ""}`
            : direct
              ? "Say hello: type below, or tap Introduce me. Their replies appear here as captions."
              : "Captions appear here the moment anyone speaks."}
      </p>
      <div className="mt-6 xl:hidden">
        <CallProgress state={call.state} />
      </div>
    </div>
  );
}
