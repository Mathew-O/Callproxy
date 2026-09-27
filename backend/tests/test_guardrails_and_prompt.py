from app.agent import TOOLS, build_instructions
from app.guardrails import is_allowed, normalize_number, split_facts
from app.models import CallTask


def test_normalize_number_handles_common_formats():
    assert normalize_number("(215) 555-0142") == "+12155550142"
    assert normalize_number("1-215-555-0142") == "+12155550142"
    assert normalize_number("+44 20 7946 0958") == "+442079460958"
    assert normalize_number("") == ""


def test_allowlist_matches_regardless_of_formatting():
    allow = ["+1 215 555 0142", "(610) 555-0199"]
    assert is_allowed("215.555.0142", allow)
    assert is_allowed("+16105550199", allow)
    assert not is_allowed("+12155550143", allow)
    assert not is_allowed("", allow)


def test_sensitive_facts_are_withheld():
    safe, withheld = split_facts(
        {
            "Date of birth": "March 14, 2004",
            "Callback number": "215-555-0142",
            "Insurance member ID": "123456789",
            "SSN": "123-45-6789",
            "Card": "4111 1111 1111 1111",
            "Portal password": "hunter2",
            "Notes": "my social is 123-45-6789",
            "Bank routing": "021000021",
        }
    )
    assert set(safe) == {"Date of birth", "Callback number", "Insurance member ID"}
    assert set(withheld) == {"SSN", "Card", "Portal password", "Notes", "Bank routing"}


def _task() -> CallTask:
    return CallTask(
        to_number="+12155550142",
        callee_name="Dr. Rivera's office",
        user_name="Sam Lee",
        goal="Book a teeth cleaning.",
        facts={"Date of birth": "March 14, 2004"},
        constraints=["Only Tuesday or Thursday afternoons"],
        timezone="America/New_York",
    )


def test_instructions_cover_the_spec_outline():
    task = _task()
    text = build_instructions(task, {"Date of birth": "March 14, 2004"})
    assert "Hi, I'm an AI assistant calling on behalf of Sam Lee." in text
    assert "Book a teeth cleaning." in text  # goal word for word
    assert "- Date of birth: March 14, 2004" in text
    assert "- Only Tuesday or Thursday afternoons" in text
    assert "ask_user" in text and "record_outcome" in text and "end_call" in text
    assert "Social Security" in text


def test_instructions_leave_out_withheld_facts():
    task = _task()
    task.facts["SSN"] = "123-45-6789"
    safe, _ = split_facts(task.facts)
    assert "123-45-6789" not in build_instructions(task, safe)


def test_tools_match_the_spec():
    names = {t["name"] for t in TOOLS}
    assert names == {"ask_user", "record_outcome", "end_call"}
    record = next(t for t in TOOLS if t["name"] == "record_outcome")
    assert record["parameters"]["properties"]["status"]["enum"] == ["success", "partial", "failed"]
