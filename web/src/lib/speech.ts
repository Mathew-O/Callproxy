import { api } from "../api";
import type { Speaker } from "../types";

/**
 * Plays call lines out loud in the browser, one at a time: ElevenLabs voices when the
 * server has a key, the browser's own speech otherwise. Used to make practice calls
 * audible to a room, and to preview voices.
 */

let currentAudio: HTMLAudioElement | null = null;

function playBlob(blob: Blob): Promise<void> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentAudio = audio;
    const done = () => {
      URL.revokeObjectURL(url);
      if (currentAudio === audio) currentAudio = null;
      resolve();
    };
    audio.onended = done;
    audio.onerror = done;
    audio.play().catch(done);
  });
}

export function playUrl(url: string): Promise<void> {
  return new Promise((resolve) => {
    stopAll();
    const audio = new Audio(url);
    currentAudio = audio;
    audio.onended = () => resolve();
    audio.onerror = () => resolve();
    audio.play().catch(() => resolve());
  });
}

// Distinct browser voices per speaker, so a practice call doesn't sound like one person.
const BROWSER_VOICE_SLOT: Record<Speaker, number> = { agent: 0, callee: 1, user: 2 };

function browserSpeak(text: string, speaker: Speaker): Promise<void> {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) return resolve();
    const english = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("en"));
    const utterance = new SpeechSynthesisUtterance(text);
    if (english.length) utterance.voice = english[BROWSER_VOICE_SLOT[speaker] % english.length];
    utterance.rate = 1.05;
    const safety = window.setTimeout(resolve, 1500 + text.length * 90);
    utterance.onend = utterance.onerror = () => {
      window.clearTimeout(safety);
      resolve();
    };
    speechSynthesis.speak(utterance);
  });
}

export function stopAll() {
  currentAudio?.pause();
  currentAudio = null;
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}

interface Line {
  text: string;
  speaker: Speaker;
  audio: Promise<Blob | null>;
}

export class CallSpeaker {
  private queue: Line[] = [];
  private running = false;
  private stopped = false;

  constructor(private useElevenLabs: boolean) {
    // Some browsers load their voice list lazily.
    if ("speechSynthesis" in window) speechSynthesis.getVoices();
  }

  enqueue(text: string, speaker: Speaker, voiceId: string) {
    if (this.stopped) return;
    // Start fetching right away so the audio is ready when its turn comes.
    const audio = this.useElevenLabs
      ? api.tts(text, voiceId).catch(() => {
          this.useElevenLabs = false; // no key or quota: use the browser voice from here on
          return null;
        })
      : Promise.resolve(null);
    this.queue.push({ text, speaker, audio });
    void this.run();
  }

  private async run() {
    if (this.running) return;
    this.running = true;
    while (this.queue.length && !this.stopped) {
      const line = this.queue.shift()!;
      const blob = await line.audio;
      if (this.stopped) break;
      await (blob ? playBlob(blob) : browserSpeak(line.text, line.speaker));
    }
    this.running = false;
  }

  stop() {
    this.stopped = true;
    this.queue = [];
    stopAll();
  }
}

/** Hear a voice before picking it. Uses the ElevenLabs sample when there is one. */
export async function previewVoice(voiceId: string, previewUrl: string | null, tts: boolean, sample: string) {
  stopAll();
  if (previewUrl) return playUrl(previewUrl);
  if (tts) {
    const blob = await api.tts(sample, voiceId);
    return playBlob(blob);
  }
}
