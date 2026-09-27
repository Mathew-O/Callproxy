# CallProxy

**Type it. We'll say it.** CallProxy lets people make real phone calls without speaking: Deaf and hard-of-hearing people, people with speech impairments or phone anxiety, and non-native speakers. You type, a natural ElevenLabs voice says it on the call, and the other side's replies appear as live captions. When a call gets complicated, hand it to an AI agent that carries on for you and brings every real decision back to your screen.

**Try it now: [mathew-o.github.io/Callproxy](https://mathew-o.github.io/Callproxy/)** (a browser-only build: practice calls run right in the page, in your browser's voice). Press **Demo → Practice demo** to watch a whole call play itself.

Built for OwlHacks 2026 (AI & Agents, HCI, Health & Wellness). The original spec is in [CallProxy — OwlHacks 2026 Spec.md](CallProxy%20—%20OwlHacks%202026%20Spec.md); the stage demo is in [DEMO.md](DEMO.md).

## Quick start (no keys needed)

Every screen works against a built-in **practice call**: a scripted dental receptionist who reacts to what you type (and to the agent). You can exercise typing, hand-offs, the decision card, the summary, and the calendar export without Twilio or any keys. Practice calls also play both sides through the browser: ElevenLabs voices with a key, the browser's own voices without one.

```powershell
# backend (Python 3.11+)
python -m venv backend/.venv
backend/.venv/Scripts/python -m pip install -r backend/requirements-dev.txt

# web
npm --prefix web install
```

Run both in dev (two terminals), then open http://localhost:5173:

```powershell
backend/.venv/Scripts/python -m uvicorn app.main:app --app-dir backend --port 8000
```

```powershell
npm --prefix web run dev
```

Click **Try a practice call** and start typing, or **Watch the demo** to see the whole story play itself (the app types, hands off to the agent, and picks a slot). In the form, a number ending in `0000` simulates nobody picking up.

### One-click stage demo

The **Demo** button in the top bar (on every screen) starts the stage demo with no form to fill in:

- **Practice demo** rings the practice receptionist.
- **Live demo** calls the judge's phone: `DEMO_NUMBER` in `.env`, or the first `ALLOWED_NUMBERS` entry.

Leave **Type Jordan's lines automatically** on and the app types Jordan's side as the other person talks. It keys off what they say, so it follows a judge reading the cue card too. Bookmark `#/demo` or `#/demo/live` to start with a single click. See [DEMO.md](DEMO.md) for the run-of-show.

### The web link

Every push to `main` builds a static version with `VITE_STATIC=1` and publishes it to GitHub Pages (see `.github/workflows/pages.yml`). In that build, [`web/src/local/engine.ts`](web/src/local/engine.ts) runs the practice call in the browser. It's a TypeScript port of the backend's call runtime and simulator, so there's no server to host. Real calls and ElevenLabs voices need the backend.

For the demo, build the web app once. The backend then serves the UI, the API, and the Twilio webhooks on one port, so one tunnel covers everything:

```powershell
npm --prefix web run build
backend/.venv/Scripts/python -m uvicorn app.main:app --app-dir backend --port 8000
```

## Going live

1. **Twilio:** create an account, buy a voice-capable number, and **upgrade the account** (about $20). Trial accounts only dial verified numbers and play a trial announcement first, which would wreck the demo.
2. **Tunnel:** Twilio needs a public `https` and `wss` address. `cloudflared` is already installed:
   ```powershell
   cloudflared tunnel --url http://localhost:8000
   ```
   Copy the `https://….trycloudflare.com` URL. Quick-tunnel URLs change on every restart, so update `.env` and restart the backend when they do.
3. **Voice:** get an ElevenLabs API key (elevenlabs.io → Settings → API keys). That's all: on the first live call, CallProxy creates an agent called "CallProxy phone agent" with phone audio (`ulaw_8000`) in and out, plus its three client tools. It updates them on every backend start, so nothing needs setting up in the dashboard. OpenAI Realtime still works as a fallback (`VOICE_PROVIDER=openai`).
4. **Config:** copy `.env.example` to `.env` and fill in `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_NUMBER`, `PUBLIC_URL`, `ELEVENLABS_API_KEY`, and `ALLOWED_NUMBERS` (team and judge phones only). Settings load when the backend starts.
5. **Check each piece:**
   ```powershell
   # Milestone 1: your phone rings and plays a message (needs only the Twilio settings)
   backend/.venv/Scripts/python backend/scripts/say_hello.py +12155550142

   # Creates/updates the ElevenLabs agent, then runs a text-only rehearsal: the agent must
   # say it's an AI and hand a two-slot offer to ask_user
   backend/.venv/Scripts/python backend/scripts/check_elevenlabs.py

   # Same check for the OpenAI fallback
   backend/.venv/Scripts/python backend/scripts/check_realtime.py
   ```
6. Place a real call from the UI. **Real call** unlocks once every setting is present, and the top bar shows which voice is live.

## How it works

```
Browser (React) ◀── WS /ws/calls/{id}: status, transcript, ask_user, outcome ──┐
      │ REST /calls …                                                          │
      ▼                                                                        │
FastAPI bridge ── REST ──▶ Twilio Voice ──▶ callee's phone                     │
      ▲  ◀── WS /twilio/media/{id}: 8 kHz mu-law, both ways ──┘                 │
      └──── WS: audio, transcripts, tool calls ────▶ ElevenLabs Agents ────────┘
                                                     (or OpenAI Realtime)
```

- Twilio fetches TwiML from `/twilio/voice/{id}` on answer, which opens a Media Stream to `/twilio/media/{id}`. A per-call token rides along as a stream parameter, so nothing else can attach to a call.
- **Typed lines** (`POST /calls/{id}/say`) are voiced with ElevenLabs TTS (Flash v2.5, phone-format audio) in the voice you picked, slotted between the agent's sentences, and tracked on screen as waiting → speaking → said. This works whichever agent provider is running.
- **Taking over / handing back** (`POST /calls/{id}/mode`): taking over pauses the agent and cuts it off mid-sentence. While paused, ElevenLabs Scribe realtime speech-to-text captions the callee (the OpenAI fallback keeps transcribing, but its replies are turned off). Handing back briefs the agent on everything said while it was paused, and it carries on from there. An open decision card closes when you take over.
- [`backend/app/bridge.py`](backend/app/bridge.py) is the Twilio side, shared by both voice providers. It plays agent audio with marks so it knows what the callee has actually heard, flushes playback when they cut in, reports who is speaking, and hangs up only after the goodbye has played.
- [`backend/app/elevenlabs.py`](backend/app/elevenlabs.py) (default) connects each call to an ElevenLabs agent over a signed websocket and overrides the agent's prompt with that call's task. ElevenLabs handles speech recognition, the LLM, turn-taking, and the voice. Phone audio passes through untouched in both directions.
  - `ask_user`, `record_outcome`, and `end_call` are ElevenLabs client tools. `ask_user` forces pre-tool speech, so the callee hears "one moment" before the pause.
  - Type-to-speak lines go through ElevenLabs TTS in the agent's own voice. They're slotted between the agent's sentences, and the agent is told what "it" just said.
  - The signed URL is fetched before dialing, so a bad key or quota error shows on the form instead of as dead air after someone picks up.
- [`backend/app/realtime.py`](backend/app/realtime.py) is the OpenAI Realtime fallback. On barge-in it truncates the agent's message to what was actually heard, and it adds the "one moment" filler itself if the model skips it.
- **`ask_user`:** the decision card opens, and the answer goes back as the tool result. After 30 seconds the agent offers to call back. A late answer is still passed on.
- [`backend/app/calls.py`](backend/app/calls.py) holds call state in memory and runs the tool logic shared by the live bridge and [the simulator](backend/app/simulator.py).

### Guardrails

- The agent says it's an AI in its first sentence.
- It only knows the facts the user entered, and asks instead of guessing.
- Facts that look like card numbers, SSNs, passwords, or bank details are withheld from the prompt entirely. The live view says which ones.
- Only numbers in `ALLOWED_NUMBERS` can be dialed.
- Calls are capped at 5 minutes: the agent is told to wrap up at 4:30, the backend hangs up at 5:00, and Twilio's `time_limit` is a backstop.
- Twilio webhook signatures are checked.

### Accessibility and UX

- **The composer is the heart of the call screen:** type and press Enter to speak, pick your voice right in the input row, and use one-tap phrases ("Introduce me", "Could you repeat that?", "Please speak slower"). Take over or hand back with one button.
- **Voices:** a picker lists ElevenLabs voices with previews. With a key it lists your whole library, cloned voices included. Without one it shows ElevenLabs' premade voices.
- **Voice bars:** while the other person talks, four vertical audio bars bounce beside the captions, then settle into dots when they stop. On phones they sit under the newest caption instead of covering it.
- **Who's talking:** chips light up when the agent or the callee is speaking, before their words arrive. Hearing callers get this for free; Deaf users otherwise can't tell "they're answering" from "the line went quiet".
- **Captions you control:** three caption sizes, light/dark/system themes, and per-line timestamps. Settings are remembered and applied before first paint.
- **Call preview:** before dialing, the compose page shows the agent's opening line, what it may share, what it will never say (sensitive facts are flagged as you type), and when it will ask you.
- **Quick phrases:** "Could you repeat that?" and similar lines are one tap away. Any typed line is spoken word for word.
- A call-progress stepper (Dialing → Ringing → Talking → Confirming → Done) sits alongside the status pill.
- The transcript is an `aria-live="polite"` log that announces each finished line once. Partial lines stay silent until final.
- The decision card takes focus when it appears and works with the keyboard alone. Options are big buttons, keys 1–9 pick them, and a free-text answer is always available.
- A decision alert flashes the screen (two slow pulses, a steady frame under reduced motion), vibrates the phone, and changes the tab title. It never relies on sound.
- The layout holds at 200% text and phone widths, and switches to page scrolling on short screens. Type is Atkinson Hyperlegible Next and Mono, designed by the Braille Institute for low-vision readers. Every color pair meets WCAG AA in both themes, and axe-core reports no violations on any screen in either theme.

## Demo day

- Print the receptionist cue card: http://localhost:8000/cue-card.html. It has the judge offer two slots, which guarantees the decision card fires.
- Put the judge's number in `ALLOWED_NUMBERS`.
- On a loud floor with the judge on speakerphone, set `ELEVENLABS_TURN_EAGERNESS=patient` (or, for OpenAI, `VAD_THRESHOLD=0.7` and `NOISE_REDUCTION=far_field`) so room noise doesn't interrupt the agent.
- The summary screen shows the agent's average response time (the callee finishing a sentence to the agent's first audio). Quote that number when judges ask how fast it is.
- Record a full successful call as a backup video in case the wifi or tunnel fails, and run from a phone hotspot if you can.

## Tests

```powershell
backend/.venv/Scripts/python -m pytest backend
npm --prefix web test
```

The backend suite drives live calls through a fake Twilio Media Stream and fake ElevenLabs and OpenAI sockets. It covers ElevenLabs agent and tool provisioning (with a mocked REST API), audio in both directions, pings, barge-in, transcript corrections, speaking activity, client-tool round trips, TTS type-to-speak, the hang-up-after-goodbye mark, model and audio-format errors, webhook signatures, and every simulated path.

## Not built yet

- Phone-menu navigation (`send_dtmf`) and voicemail detection. Both are stretch goals in the spec.
- Persistence: calls live in memory, so restarting the backend clears them.
