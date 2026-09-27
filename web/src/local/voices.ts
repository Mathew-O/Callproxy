import type { Voice } from "../types";

// ElevenLabs premade voices (mirrors backend/app/voices.py), for the browser-only demo.
const PREMADE: [string, string, string, string, string][] = [
  ["SAz9YHcvj6GT2YYXdXww", "River", "neutral", "American", "Relaxed, neutral, informative"],
  ["EXAVITQu4vr4xnSDxMaL", "Sarah", "female", "American", "Mature, reassuring, confident"],
  ["cjVigY5qzO86Huf0OWal", "Eric", "male", "American", "Smooth, trustworthy"],
  ["FGY2WhTYpPnrIDTdsKH5", "Laura", "female", "American", "Enthusiastic, quirky"],
  ["TX3LPaxmHKxFdv7VOQHJ", "Liam", "male", "American", "Energetic, young"],
  ["XrExE9yKIg1WjnnlVkGX", "Matilda", "female", "American", "Knowledgeable, professional"],
  ["JBFqnCBsd6RMkjVDRZzb", "George", "male", "British", "Warm, captivating storyteller"],
  ["Xb7hH8MSUJpSbSDYk0k2", "Alice", "female", "British", "Clear, engaging educator"],
  ["IKne3meq5aSn9XLyUdCD", "Charlie", "male", "Australian", "Deep, confident, energetic"],
  ["pFZP5JQG7iQjIQuC4Bku", "Lily", "female", "British", "Velvety actress"],
  ["nPczCjzI2devNBz1zQrb", "Brian", "male", "American", "Deep, resonant, comforting"],
  ["cgSgspJ2msm6clMCkdW9", "Jessica", "female", "American", "Playful, bright, warm"],
];

export const LOCAL_VOICES: Voice[] = PREMADE.map(([voice_id, name, gender, accent, description]) => ({
  voice_id,
  name,
  gender,
  accent,
  description,
  preview_url: null,
  source: "premade",
}));

export const DEFAULT_AGENT_VOICE = "EXAVITQu4vr4xnSDxMaL";
export const DEFAULT_MY_VOICE = "SAz9YHcvj6GT2YYXdXww";
export const RECEPTIONIST_VOICE = "FGY2WhTYpPnrIDTdsKH5";

export function voiceName(id: string | null | undefined): string {
  return LOCAL_VOICES.find((v) => v.voice_id === id)?.name ?? (id ? "Custom voice" : "Default voice");
}
