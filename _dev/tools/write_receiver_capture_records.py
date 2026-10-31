"""Writes a receiver capture case's expected record from the record Spectra served for a live run,
for the receiver capture suite under conformance/receiver_capture/.

The record, as `GET /api/turns/<trace id>` served it for the run's last turn, holds every turn of the
conversation. Each turn keeps its turn event, its proxies' calls with their links, and the events
the receiver wrote, in the order the record has them; its wire and check events are left out, since
the receiver neither reads nor writes them. It shares no code with Spectra. From the repository root:

    python3 -I _dev/tools/write_receiver_capture_records.py --record <served record>.json \\
        --out conformance/test_data/receiver_capture/v0_1/<case>/expected.json

`--derive` writes one of the two cases derived from the ADK time-window case's recording instead, from
its exports and its expected record:

- `logs_before_span`: the first model call alone, the turn's first proxy call and the first
  `generate_content` span, whose log records arrived in an export before the span's own, every other
  span and log record left out of the exports, which keep their arrival order and times.
- `unplaced`: the first turn's spans from ADK's scope, and a2a-sdk's spans that started outside its
  range and before the conversation's next turn, with a second turn of the same conversation that
  opens a second after the first and closes with it, so that the spans starting in no turn's range,
  or in both turns', are not placed.

    python3 -I _dev/tools/write_receiver_capture_records.py --derive logs_before_span \\
        --exports conformance/test_data/receiver_capture/v0_1/adk_time_window/exports.json \\
        --record conformance/test_data/receiver_capture/v0_1/adk_time_window/expected.json \\
        --out conformance/test_data/receiver_capture/v0_1/logs_before_span/
"""

import argparse
import json
import os


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--record", required=True, help="the record Spectra served, or for --derive the case's expected record")
    parser.add_argument("--out", required=True, help="the expected record to write, or for --derive the case's directory")
    parser.add_argument("--derive", choices=["logs_before_span", "unplaced"], help="a case derived from the ADK time-window case")
    parser.add_argument("--exports", help="for --derive, the ADK time-window case's exports")
    args = parser.parse_args()

    with open(args.record, encoding="utf-8") as file:
        record = json.load(file)
    if args.derive is None:
        write(args.out, {"version": record["version"], "turns": [trimmed(turn) for turn in record["turns"]]})
        return
    with open(args.exports, encoding="utf-8") as file:
        exports = json.load(file)
    derived = LOGS_BEFORE_SPAN(record, exports) if args.derive == "logs_before_span" else UNPLACED(record, exports)
    os.makedirs(args.out, exist_ok=True)
    write(os.path.join(args.out, "exports.json"), derived["exports"])
    write(os.path.join(args.out, "expected.json"), derived["record"])


def kind(event):
    return event["attributes"]["a2ui.event.kind"]


def received(event):
    return "a2ui.received.attributes" in event["attributes"]


def trimmed(turn):
    """The turn event, the proxies' calls and the received events."""
    return {"events": [event for event in turn["events"] if received(event) or kind(event) in ("turn", "model_call", "tool_call")]}


def own_events(turn):
    """The turn event and the proxies' calls, without the receiver's links, for a derived case's input."""
    events = []
    for event in turn["events"]:
        if received(event):
            continue
        event = dict(event)
        event.pop("links", None)
        events.append(event)
    return events


def spans_of(export):
    for resource in export["body"].get("resourceSpans", []):
        for scoped in resource.get("scopeSpans", []):
            for span in scoped.get("spans", []):
                yield scoped.get("scope", {}), span


def logs_of(export):
    for resource in export["body"].get("resourceLogs", []):
        for scoped in resource.get("scopeLogs", []):
            for log in scoped.get("logRecords", []):
                yield scoped.get("scope", {}), log


def filtered(exports, keep_span, keep_log):
    """The exports with only the spans and log records kept, each export that keeps none left out."""
    kept = []
    for export in exports:
        body = json.loads(json.dumps(export["body"]))
        count = 0
        for resource in body.get("resourceSpans", []):
            for scoped in resource.get("scopeSpans", []):
                scoped["spans"] = [span for span in scoped.get("spans", []) if keep_span(scoped.get("scope", {}), span)]
                count += len(scoped["spans"])
            resource["scopeSpans"] = [scoped for scoped in resource.get("scopeSpans", []) if scoped["spans"]]
        for resource in body.get("resourceLogs", []):
            for scoped in resource.get("scopeLogs", []):
                scoped["logRecords"] = [log for log in scoped.get("logRecords", []) if keep_log(scoped.get("scope", {}), log)]
                count += len(scoped["logRecords"])
            resource["scopeLogs"] = [scoped for scoped in resource.get("scopeLogs", []) if scoped["logRecords"]]
        if count > 0:
            kept.append({**export, "body": body})
    return kept


def LOGS_BEFORE_SPAN(record, exports):
    first = record["turns"][0]
    calls = [event for event in own_events(first) if kind(event) == "model_call"]
    span = next(event for event in first["events"] if received(event) and event["name"].startswith("generate_content"))
    key = (span["traceId"], span["spanId"])
    log_seen = span_seen = False
    for export in exports:
        if any((s["traceId"], s["spanId"]) == key for _, s in spans_of(export)):
            span_seen = True
        if any((log.get("traceId"), log.get("spanId")) == key for _, log in logs_of(export)) and not span_seen:
            log_seen = True
    assert log_seen, "a log record of the span arrived before the span"
    turn_event = next(event for event in own_events(first) if kind(event) == "turn")
    kept = filtered(exports, lambda _, s: (s["traceId"], s["spanId"]) == key, lambda _, log: (log.get("traceId"), log.get("spanId")) == key)
    return {"exports": kept, "record": {"version": record["version"], "turns": [{"events": [turn_event, calls[0]]}]}}


def UNPLACED(record, exports):
    first = record["turns"][0]
    events = own_events(first)
    turn_event = next(event for event in events if kind(event) == "turn")
    start = int(turn_event["startTimeUnixNano"])
    end = int(turn_event["endTimeUnixNano"])
    later = min([int(next(e for e in turn["events"] if kind(e) == "turn")["startTimeUnixNano"]) for turn in record["turns"][1:]] or [end + 60_000_000_000])
    second = json.loads(json.dumps(turn_event))
    second["traceId"] = "e" * 32
    second["spanId"] = "e" * 16
    second["startTimeUnixNano"] = str(start + 1_000_000_000)
    second["attributes"]["a2ui.turn.capture_paths"] = [path for path in second["attributes"]["a2ui.turn.capture_paths"] if path != "otel_receiver"]

    def keep_span(scope, span):
        name = scope.get("name")
        at = int(span["startTimeUnixNano"])
        if name == "gcp.vertex.agent":
            return start <= at <= end
        return name == "a2a-python-sdk" and not (start <= at <= end) and at < later

    kept = filtered(exports, keep_span, lambda *_: False)
    return {"exports": kept, "record": {"version": record["version"], "turns": [{"events": events}, {"events": [second]}]}}


def write(path, value):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8") as file:
        json.dump(value, file, indent=2, ensure_ascii=False)
        file.write("\n")


if __name__ == "__main__":
    main()
