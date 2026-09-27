export interface FactRow {
  key: string;
  value: string;
}

export interface CallForm {
  callee_name: string;
  to_number: string;
  user_name: string;
  goal: string;
  facts: FactRow[];
  constraints: string[];
  /** Type every line yourself, or let the agent talk. */
  mode: "direct" | "agent";
  my_voice_id: string | null;
  agent_voice_id: string | null;
}

export interface Template {
  id: "appointment" | "prescription" | "cancel";
  label: string;
  blurb: string;
  form: Omit<CallForm, "to_number" | "user_name" | "mode" | "my_voice_id" | "agent_voice_id">;
}

/** The demo persona: a Deaf student who needs a dentist appointment. */
export const PERSONA = "Jordan Lee";

export const EMPTY_FORM: CallForm = {
  callee_name: "",
  to_number: "",
  user_name: "",
  goal: "",
  facts: [{ key: "", value: "" }],
  constraints: [""],
  mode: "direct",
  my_voice_id: null,
  agent_voice_id: null,
};

export const TEMPLATES: Template[] = [
  {
    id: "appointment",
    label: "Book an appointment",
    blurb: "Dentist, doctor, or salon, on your schedule",
    form: {
      callee_name: "Dr. Rivera's office",
      goal: "Book a teeth cleaning appointment.",
      facts: [
        { key: "Patient name", value: "Jordan Lee" },
        { key: "Date of birth", value: "March 14, 2005" },
        { key: "Insurance", value: "Delta Dental PPO" },
        { key: "Best contact", value: "Text (215) 555-0142. I'm Deaf, so please no voice calls." },
      ],
      constraints: ["I'm free Tuesday and Thursday afternoons.", "Don't book anything before 1 PM."],
    },
  },
  {
    id: "prescription",
    label: "Check a prescription",
    blurb: "Is it ready? When does the pharmacy close?",
    form: {
      callee_name: "Main Street Pharmacy",
      goal: "Check whether my amoxicillin prescription is ready for pickup, and ask what time the pharmacy closes today.",
      facts: [
        { key: "Name", value: "Jordan Lee" },
        { key: "Date of birth", value: "March 14, 2005" },
        { key: "Rx number", value: "6043172" },
      ],
      constraints: ["Don't approve a substitution or a different dose without asking me."],
    },
  },
  {
    id: "cancel",
    label: "Cancel a subscription",
    blurb: "Get out of it, without the retention pitch",
    form: {
      callee_name: "FitLife Gym",
      goal: "Cancel my gym membership, effective today, and get a confirmation number.",
      facts: [
        { key: "Name", value: "Jordan Lee" },
        { key: "Member email", value: "jordan.lee@example.com" },
        { key: "Member ID", value: "FL-208817" },
      ],
      constraints: [
        "Don't accept a discount or a pause instead of cancelling.",
        "Ask me before agreeing to any cancellation fee.",
      ],
    },
  },
];
