import { useCallback, useEffect, useRef, useState } from "react";
import { CallSpeaker } from "../lib/speech";
import type { FeedEvent } from "../types";

/** Voices a practice call in the browser so a room (or a screen recording) hears it. */
export function useCallAudio(tts: boolean) {
  const [enabled, setEnabled] = useState(true);
  const speaker = useRef<CallSpeaker | null>(null);
  const settings = useRef({ enabled, tts });
  settings.current = { enabled, tts };

  useEffect(() => {
    if (!enabled) {
      speaker.current?.stop();
      speaker.current = null;
    }
  }, [enabled]);

  useEffect(() => () => speaker.current?.stop(), []);

  const onEvent = useCallback((event: FeedEvent) => {
    if (event.type !== "sim_speech" || !settings.current.enabled) return;
    speaker.current ??= new CallSpeaker(settings.current.tts);
    speaker.current.enqueue(event.data.text, event.data.speaker, event.data.voice_id);
  }, []);

  return { enabled, setEnabled, onEvent };
}
