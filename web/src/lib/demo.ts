import { api, STATIC } from "../api";
import type { CallTask } from "../types";
import { goToCall } from "./nav";

/** The stage demo (mirrors DEMO_TASK in backend/app/main.py): Jordan, a Deaf student, books a cleaning. */
export const DEMO_TASK: CallTask = {
  to_number: "+12155550142",
  callee_name: "Dr. Rivera's office",
  user_name: "Jordan Lee",
  goal: "Book a teeth cleaning appointment.",
  facts: {
    "Patient name": "Jordan Lee",
    "Date of birth": "March 14, 2005",
    Insurance: "Delta Dental PPO",
    "Best contact": "Text (215) 555-0142. I'm Deaf, so please no voice calls.",
  },
  constraints: ["I'm free Tuesday and Thursday afternoons."],
  mode: "direct",
};

/** Start the demo call and open it with autoplay typing on (unless `autoplay` is false). */
export async function startDemo(live: boolean, autoplay = true): Promise<void> {
  const { call_id } = STATIC ? await api.createCall(DEMO_TASK, true) : await api.demoCall(live);
  goToCall(call_id, { demo: autoplay });
}

/** What autoplay types, and the cue that triggers each line. Loose enough for a live judge. */
export const DEMO_SCRIPT = {
  booking: "I'd like to book a teeth cleaning, please.",
  birthday: "March 14, 2005.",
  asksBirthday: /birth|dob|born/i,
  offersTwo: /openings|which (works|one|is better)|\bor (mon|tue|wed|thu|fri|sat|sun)|\b(am|pm)\b.*\bor\b/i,
};
