"""Writes the wrapper capture suite's expected records, under conformance/wrapper_capture/.

For each case, and each language the case runs in, it reads the facts the record states off the
pinned agent SDK, with `wrapper_capture_facts.py` for Python and `wrapper_capture_facts.mjs` for
TypeScript, and writes the turn the harness should capture: its turn event, the model proxy's call
for a case whose driver runs before the turn opens, and the `prompt_generation` or `parse` event
the wrapper's span becomes, in the turn record's shapes, as the receiver writes a span sent in the
producers' wire forms. One record serves both languages when the two come out equal, apart from
what the comparison skips; otherwise each language has its own. The ids and times are the A2A
capture suite's kind of stand-ins. It shares no code with Spectra. From the repository root, with
the TypeScript agent SDK built in the `a2ui-upstream` worktree, in a Python 3.12 environment holding
the pinned Python SDK and `a2ui-adk`, such as the repository's own:

    .venv/bin/python -I _dev/tools/write_wrapper_capture_records.py \\
        --upstream ../a2ui-upstream [--case <case> ...]

It prints, for each case, the expected record files it wrote.
"""

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SUITE = ROOT / "conformance/test_data/wrapper_capture/v0_1"
TOOLS = Path(__file__).resolve().parent
SCOPE = "a2ui-spectra-instrumentation"
TOOL_NAME = "send_a2ui_json_to_client"
MS = 1_000_000
BASE = 1_792_800_000_000_000_000
USER_MESSAGE = "Show a card for one restaurant."
STACKTRACE = "(the stack trace, which the comparison checks is present)"


def stand_in(case: str, role: str, length: int) -> str:
    return hashlib.sha256(f"{case}:{role}".encode()).hexdigest()[:length]


def wire(value):
    """An attribute in the producers' wire form: an array or an object as its JSON text."""
    if isinstance(value, (list, dict)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return value


def facts_of(language: str, job_path: Path, upstream: Path) -> dict:
    if language == "python":
        command = [sys.executable, "-I", str(TOOLS / "wrapper_capture_facts.py"), str(job_path)]
    else:
        command = ["node", str(TOOLS / "wrapper_capture_facts.mjs"), str(upstream), str(job_path)]
    done = subprocess.run(command, capture_output=True, text=True, cwd=ROOT)
    if done.returncode != 0:
        raise SystemExit(f"{job_path.parent.name} ({language}) failed:\n{done.stderr}")
    return json.loads(done.stdout.strip().splitlines()[-1])


def utf16(text: str) -> int:
    return len(text.encode("utf-16-le")) // 2


def exception_event(time: int, error: dict) -> dict:
    attributes = {
        "exception.type": error["type"],
        "exception.message": error["message"],
        "exception.stacktrace": STACKTRACE,
    }
    if "block" in error:
        attributes["a2ui.parse.block.start"], attributes["a2ui.parse.block.end"] = error["block"]
    if "details" in error:
        attributes["a2ui.parse.error.details"] = error["details"]
    return {"timeUnixNano": str(time), "name": "exception", "attributes": attributes}


def step_event(case: str, job: dict, facts: dict, text: str | None, start: int) -> dict:
    """The event the wrapper's span becomes, with the attributes it sent as received."""
    entry = job["entryPoint"]
    errors = facts.get("errors", [])
    sdk = {"a2ui.sdk.name": facts["sdk"]["name"], "a2ui.sdk.version": facts["sdk"]["version"]}
    catalogs = [
        {"catalogId": c["catalogId"], "protocolVersion": c["protocolVersion"]}
        for c in job["catalogs"]
    ]
    events = []
    if entry == "generate":
        kind = "prompt_generation"
        names = {
            **({"a2ui.prompt.ui_section": facts["section"]} if "section" in facts else {}),
            "a2ui.prompt.inference_format": job["inferenceFormat"],
            "a2ui.prompt.catalogs": catalogs,
            **sdk,
        }
        end = start + 2 * MS
        events = [exception_event(start + MS, error) for error in errors]
    else:
        kind = "parse"
        streamed = entry == "open_stream"
        input_text = text
        if streamed:
            ends = json.loads((SUITE / case / job["chunks"]).read_text())[: facts["fed"]]
            input_text = slice_utf16(text, ends[-1])
        names = {
            "a2ui.parse.input": input_text,
            "a2ui.parse.entry_point": entry,
            **({"a2ui.parse.wrapped": False} if job.get("wrapped", True) is False else {}),
            **({"a2ui.parse.streamed": True} if streamed else {}),
            "a2ui.parse.inference_format": job["inferenceFormat"],
            "a2ui.parse.catalogs": catalogs,
            "a2ui.parse.messages": facts["messages"],
            **sdk,
            **(
                {"gen_ai.tool.name": TOOL_NAME, "gen_ai.tool.call.result": facts["toolResult"]}
                if entry == "tool_call"
                else {}
            ),
        }
        if streamed:
            time = start
            for index, chunk_end in enumerate(ends):
                time += MS
                events.append(
                    {
                        "timeUnixNano": str(time),
                        "name": "a2ui.parse.chunk",
                        "attributes": {"a2ui.parse.chunk.end": chunk_end},
                    }
                )
                time += MS
                for error in errors:
                    if error.get("chunk") == index:
                        events.append(exception_event(time, error))
            time += MS
            for error in errors:
                if error.get("chunk") is None:
                    events.append(exception_event(time, error))
            end = time + MS
        else:
            events = [exception_event(start + MS, error) for error in errors]
            end = start + 2 * MS
    if errors:
        names["error.type"] = errors[0]["type"]
    received = {"a2ui.event.kind": kind, **{name: wire(value) for name, value in names.items()}}
    event = {
        "traceId": stand_in(case, "driver trace", 32),
        "spanId": stand_in(case, "step span", 16),
        "name": kind,
        "kind": 1,
        "startTimeUnixNano": str(start),
        "endTimeUnixNano": str(end),
        "attributes": {
            "a2ui.event.kind": kind,
            "otel.scope.name": SCOPE,
            "otel.scope.version": "0.0.0",
            **names,
            "a2ui.received.attributes": received,
        },
    }
    if events:
        event["events"] = events
    event["status"] = (
        {"code": 2, "message": errors[0]["message"]} if errors else {"code": 0}
    )
    return event


def slice_utf16(text: str, end: int) -> str:
    return text.encode("utf-16-le")[: end * 2].decode("utf-16-le")


def record_of(case: str, job: dict, facts: dict, text: str | None) -> dict:
    trace = stand_in(case, "turn trace", 32)
    turn_span = stand_in(case, "turn span", 16)
    before = job.get("beforeTurn", False)
    turn_start = BASE + (20 * MS if before else 0)
    step_start = BASE + (0 if before else 10 * MS)
    step = step_event(case, job, facts, text, step_start)
    turn_end = max(int(step["endTimeUnixNano"]), turn_start) + 10 * MS
    paths = ["otel_receiver", "wrapper"]
    events = []
    if before:
        paths = ["model_proxy", *paths]
        call_start = turn_start + MS
        events.append(
            {
                "traceId": trace,
                "spanId": stand_in(case, "model call", 16),
                "parentSpanId": turn_span,
                "name": "POST /v1beta/models/gemini-3.6-flash:generateContent",
                "kind": 3,
                "startTimeUnixNano": str(call_start),
                "endTimeUnixNano": str(call_start + 5 * MS),
                "attributes": {
                    "a2ui.event.kind": "model_call",
                    "http.request.method": "POST",
                    "url.full": "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
                    "a2ui.http.request.body": {
                        "contents": [{"role": "user", "parts": [{"text": USER_MESSAGE}]}],
                        "systemInstruction": {
                            "parts": [{"text": f"You are a restaurant agent.\n\n{facts['section']}"}]
                        },
                    },
                },
            }
        )
    turn_event = {
        "traceId": trace,
        "spanId": turn_span,
        "name": "invoke_agent",
        "kind": 3,
        "startTimeUnixNano": str(turn_start),
        "endTimeUnixNano": str(turn_end),
        "attributes": {
            "a2ui.event.kind": "turn",
            "gen_ai.operation.name": "invoke_agent",
            "a2ui.turn.outcome": "completed",
            "a2ui.turn.capture_paths": paths,
            "a2ui.turn.writer.name": "a2ui-spectra",
            "a2ui.turn.writer.version": "0.0.0",
        },
        "status": {"code": 1},
    }
    return {"version": "v0.1", "turns": [{"events": [turn_event, *events, step]}]}


def comparable(record: dict) -> str:
    """The record without what the comparison skips between languages: the SDK's name and version."""
    copy = json.loads(json.dumps(record))
    for event in copy["turns"][0]["events"]:
        for attributes in [event["attributes"], event["attributes"].get("a2ui.received.attributes", {})]:
            attributes.pop("a2ui.sdk.name", None)
            attributes.pop("a2ui.sdk.version", None)
    return json.dumps(copy, sort_keys=True, ensure_ascii=False)


def write(path: Path, record: dict) -> None:
    path.write_text(json.dumps(record, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--upstream", type=Path, required=True)
    parser.add_argument("--case", action="append")
    args = parser.parse_args()
    cases = args.case or sorted(p.name for p in SUITE.iterdir() if p.is_dir())
    for case in cases:
        job_path = SUITE / case / "input.json"
        job = json.loads(job_path.read_text())
        text = (SUITE / case / job["text"]).read_text() if "text" in job else None
        records = {
            language: record_of(case, job, facts_of(language, job_path, args.upstream), text)
            for language in job["languages"]
        }
        for old in (SUITE / case).glob("expected*.json"):
            old.unlink()
        if len({comparable(record) for record in records.values()}) == 1:
            write(SUITE / case / "expected.json", next(iter(records.values())))
            print(f"{case}: expected.json")
        else:
            for language, record in records.items():
                write(SUITE / case / f"expected_{language}.json", record)
            print(f"{case}: " + ", ".join(f"expected_{language}.json" for language in records))


if __name__ == "__main__":
    main()
