# CallProxy demo run-of-show

Three minutes. The judge's phone ringing on stage is the centerpiece. Jordan (our persona, a Deaf student) types, an ElevenLabs voice speaks for them, the judge's replies appear as captions, and halfway through Jordan hands the call to the AI agent, which brings the one real decision back to Jordan's screen.

Two ways to run it:

- **Live** (needs Twilio, ElevenLabs, and a tunnel): the judge's phone really rings.
- **Practice** (needs nothing): the same screens against a scripted receptionist. With `ELEVENLABS_API_KEY` set you hear real ElevenLabs voices through the laptop; without it the browser's own voices stand in.

## One click

Press **Demo** (top right, on every screen). Pick **Live demo** to ring the judge's phone, or **Practice demo** for the scripted receptionist. Leave **Type Jordan's lines automatically** on and the app types Jordan's side by itself as the judge follows the cue card. At the time slots it hands off to the agent and brings you the decision card: tap the option, or let it pick after a few seconds. **Take the wheel** in the blue banner hands control back to you at any moment.

Even faster: bookmark `http://localhost:8000/#/demo/live` (or `#/demo`) and open it when you're introduced.

## Before you go on stage

- [ ] `.env` has the Twilio settings, `ELEVENLABS_API_KEY`, `PUBLIC_URL` (the current tunnel), and the judge's number in `ALLOWED_NUMBERS` (and in `DEMO_NUMBER` if it isn't first).
- [ ] `backend/.venv/Scripts/python backend/scripts/check_elevenlabs.py` passes both checks.
- [ ] `backend/.venv/Scripts/python backend/scripts/say_hello.py <your number>` rings your phone.
- [ ] `npm --prefix web run build`, then start the backend and open http://localhost:8000 (or the tunnel URL).
- [ ] Place one real call to your own phone end to end.
- [ ] Print the receptionist cue card (http://localhost:8000/cue-card.html) and hand it to the judge.
- [ ] For the projector: dark theme and the largest caption size (the **A A A** control, top right). Laptop volume up.
- [ ] Backup video queued. The easiest way to make one: record the screen while **Watch the demo** plays (see below).

## The three minutes

| Time | Beat | On screen | Say |
| --- | --- | --- | --- |
| 0:00–0:20 | Hook | Home page | "Who here has put off a phone call for a week? For Jordan, who's Deaf, every call means a relay operator listening in, or asking a friend. CallProxy lets Jordan just type." |
| 0:20–0:35 | Set up | Pick **Book an appointment**, **I'll type**, open **Your voice**, choose River (preview plays), enter the judge's number, **Place the call**. | "Jordan picks the voice people will hear. It's ElevenLabs, so it sounds like a person, not a robot." |
| 0:35–1:15 | Jordan types | Judge answers. Tap **Introduce me**, then type *"I'd like to book a teeth cleaning, please."* and the date of birth when asked. | "Everything the receptionist says appears as captions, and you can see who's talking before the words even land. That's ElevenLabs Scribe transcribing the call live." |
| 1:15–2:00 | Hand-off and decision | When the judge offers two times, tap **Hand back to agent**. The agent says "one moment," the screen flashes, and the decision card appears. Tap **1**. The agent confirms, reads back, and says goodbye. | "When it gets complicated, Jordan hands the call to an AI agent. It picks up from what was said, and it never decides for Jordan: the choice comes back to this screen." |
| 2:00–2:30 | Summary | Booked time, confirmation number, **Add to calendar**, lines typed. | "Done: booked, on the calendar, with a full transcript." |
| 2:30–3:00 | How it works and what's next | README diagram | See talking points below. |

**If the agent doesn't bring up the decision card** (say it wanders), take the call back with **Take over & type** and type *"Thursday at 3 works great."* The typing path is the headline anyway.

**If the judge talks too fast**, tap **Could you repeat that?**. It's a good moment to show off.

## Talking points (2:30–3:00)

- **Three ElevenLabs pieces:** Flash v2.5 text-to-speech reads Jordan's typed lines on the call, Scribe realtime captions the other side, and an ElevenLabs Conversational AI agent with client tools stands by to take over.
- **Any voice in your ElevenLabs library works, including a cloned one.** Someone losing their voice to ALS could bank it and keep calling as themselves.
- **Honest by design:** the typed voice introduces itself as a voice reading Jordan's words, and the agent says it's an AI in its first sentence. Numbers are allowlisted, calls are capped at 5 minutes, and card numbers and passwords are never said aloud.
- **Tracks:** AI & Agents (a live phone agent with tools and a human in the loop), HCI (captions, a speaking indicator, caption sizes, keyboard-only decisions, and no WCAG A/AA violations in axe), Health & Wellness (the calls people put off are the ones that delay care).

## Practice mode (no keys)

- **Watch the demo** on the home page runs the whole story hands-free: the app types Jordan's lines keystroke by keystroke, hands off to the agent, picks a slot on the decision card, and lands on the summary. It takes about 90 seconds. Use it for the backup video or as an expo-table loop. **Take the wheel** stops it at any point.
- **Try a practice call** is the same call with you typing. The receptionist reacts to what you type: she books when you ask to, asks for a date of birth, offers two slots, repeats herself if you ask, and handles "text me a reminder."
- **Call audio** in the call header voices both sides through the laptop.

## Likely questions

- *"Isn't this a relay service?"* Relay puts a human operator in the middle of every word. CallProxy is private, instant, and works at 2 AM.
- *"What does the other person hear?"* A natural voice reading Jordan's words, starting with an introduction that says so. When the agent has the call, it says it's an AI.
- *"How fast is it?"* The summary shows the agent's average reply time for the call. Typed lines are voiced with ElevenLabs Flash, which is built for low latency.
- *"Couldn't someone use this for spam?"* It only dials allowlisted numbers, only while the user is watching, for at most 5 minutes, and it always discloses.
