// Mirrors backend/app/guardrails.py so the form can say up front what the agent won't share.
// The server is still the one that enforces it.

const SENSITIVE_KEY =
  /(\bssn\b|social\s*security|password|passcode|\bpin\b|credit|debit|payment\s*card|cvv|cvc|security\s*code|\bbank|routing|\biban\b|\bswift\b|tax\s*id|\bitin\b)/i;
const SSN_VALUE = /\b\d{3}[- ]\d{2}[- ]\d{4}\b/;
const CARD_VALUE = /\b(?:\d[ -]?){13,19}\b/g;

function luhnOk(digits: string): boolean {
  let total = 0;
  [...digits].reverse().forEach((ch, i) => {
    let d = Number(ch);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    total += d;
  });
  return total % 10 === 0;
}

export function looksSensitive(key: string, value: string): boolean {
  if (SENSITIVE_KEY.test(key) || SSN_VALUE.test(value)) return true;
  for (const match of value.matchAll(CARD_VALUE)) {
    const digits = match[0].replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhnOk(digits)) return true;
  }
  return false;
}
