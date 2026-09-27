import { useEffect, useState } from "react";
import { api } from "../api";
import type { AppConfig, Voice } from "../types";

let voicesRequest: ReturnType<typeof api.voices> | null = null;
let configRequest: Promise<AppConfig> | null = null;

/** The voices to choose from (the account's, or ElevenLabs' premade list without a key). */
export function useVoices() {
  const [state, setState] = useState<{ voices: Voice[]; fromAccount: boolean }>({ voices: [], fromAccount: false });
  useEffect(() => {
    let live = true;
    (voicesRequest ??= api.voices())
      .then((res) => live && setState({ voices: res.voices, fromAccount: res.from_account }))
      .catch(() => {
        voicesRequest = null;
      });
    return () => {
      live = false;
    };
  }, []);
  return state;
}

export function useConfig(): AppConfig | null {
  const [config, setConfig] = useState<AppConfig | null>(null);
  useEffect(() => {
    let live = true;
    (configRequest ??= api.config())
      .then((cfg) => live && setConfig(cfg))
      .catch(() => {
        configRequest = null;
      });
    return () => {
      live = false;
    };
  }, []);
  return config;
}

export function voiceById(voices: Voice[], id: string | null | undefined): Voice | undefined {
  return voices.find((v) => v.voice_id === id);
}
