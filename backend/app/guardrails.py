"""Phone-number allowlist and the facts the agent must never say out loud."""

from __future__ import annotations

import re

_SENSITIVE_KEY = re.compile(
    r"(\bssn\b|social\s*security|password|passcode|\bpin\b|credit|debit|payment\s*card|cvv|cvc|"
    r"security\s*code|\bbank|routing|\biban\b|\bswift\b|tax\s*id|\bitin\b)",
    re.IGNORECASE,
)
# Formatted SSNs only; bare 9-digit values are too often member or order IDs.
_SSN_VALUE = re.compile(r"\b\d{3}[- ]\d{2}[- ]\d{4}\b")
_CARD_VALUE = re.compile(r"\b(?:\d[ -]?){13,19}\b")


def normalize_number(raw: str) -> str:
    """Best-effort E.164: keep a leading +, strip formatting, assume US for 10 digits."""
    raw = raw.strip()
    digits = re.sub(r"\D", "", raw)
    if raw.startswith("+"):
        return "+" + digits
    if len(digits) == 10:
        return "+1" + digits
    if len(digits) == 11 and digits.startswith("1"):
        return "+" + digits
    return "+" + digits if digits else ""


def is_allowed(number: str, allowlist: list[str]) -> bool:
    target = normalize_number(number)
    return bool(target) and target in {normalize_number(n) for n in allowlist}


def _luhn_ok(digits: str) -> bool:
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = int(ch)
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def looks_sensitive(key: str, value: str) -> bool:
    if _SENSITIVE_KEY.search(key):
        return True
    if _SSN_VALUE.search(value):
        return True
    for match in _CARD_VALUE.finditer(value):
        digits = re.sub(r"\D", "", match.group())
        if 13 <= len(digits) <= 19 and _luhn_ok(digits):
            return True
    return False


def split_facts(facts: dict[str, str]) -> tuple[dict[str, str], list[str]]:
    """Return (facts the agent may share, names of facts withheld as sensitive)."""
    safe: dict[str, str] = {}
    withheld: list[str] = []
    for key, value in facts.items():
        if looks_sensitive(key, value):
            withheld.append(key)
        else:
            safe[key] = value
    return safe, withheld
