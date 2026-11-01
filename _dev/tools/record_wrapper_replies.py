"""Records the model replies the wrapper capture suite parses, under conformance/wrapper_capture/.

For each inference format it builds the agent SDK's request processor on the basic catalog at v1.0,
generates the format's prompt with the SDK, and sends it with one fixed user message to Gemini as a
stream. The reply is kept as its chunks arrived: the joined text serves the whole-text cases and the
chunk boundaries the stream cases. The reply is parsed with the SDK before it is saved, and the model
is asked again when it does not parse. Each saved reply is then checked by hand once.

It runs on the agent SDK at upstream main `825beac28` with google-genai, in a Python environment that
holds them, such as the `a2ui-upstream` worktree's own. The key is read from GOOGLE_API_KEY and is
never written. From the repository root:

    GOOGLE_API_KEY=… ../a2ui-upstream/.venv/bin/python -I _dev/tools/record_wrapper_replies.py \\
        --out conformance/test_data/wrapper_capture/v0_1 [--format express]

What it writes, for each format, into the case directories that read the reply:

- `<format>_parse_response/text.txt`: the joined reply.
- `<format>_open_stream/text.txt` and `chunks.json`, for Direct JSON and Express: the joined reply
  and each chunk's end, in UTF-16 code units of the text.
- `<format>_compile/text.txt`: the reply's first block, as the SDK's parser unwraps it.
- For Express, `express_parse_response_unwrapped/text.txt`, `tool_call_without_state/text.txt` and
  `tool_call_with_state/text.txt`: the same block.
"""

import argparse
import json
import os
import sys
from pathlib import Path

from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats import (
    AtomFormatFactory,
    DirectJsonFormatFactory,
    ElementalFormatFactory,
    ExpressFormatFactory,
)
from a2ui.parser import RawA2uiPart
from a2ui.processor import A2uiRequestProcessor
from google import genai
from google.genai import types

MODEL = "gemini-3.6-flash"
USER_MESSAGE = (
    "Show a card for one restaurant: Xi'an Famous Foods, at 45 Bayard St, New York, NY 10013, "
    "rated 4.6 out of 5, with a button to book a table."
)
FACTORIES = {
    "direct_json": DirectJsonFormatFactory,
    "express": ExpressFormatFactory,
    "elemental": ElementalFormatFactory,
    "atom": AtomFormatFactory,
}
STREAMED = {"direct_json", "express"}
ATTEMPTS = 4


def utf16_length(text: str) -> int:
    return len(text.encode("utf-16-le")) // 2


def ask(client: genai.Client, prompt: str) -> list[str]:
    """Sends the prompt and the user message as a stream, and returns the reply's chunks of text."""
    chunks = []
    for response in client.models.generate_content_stream(
        model=MODEL,
        contents=USER_MESSAGE,
        config=types.GenerateContentConfig(system_instruction=prompt),
    ):
        if response.text:
            chunks.append(response.text)
    return chunks


def first_block(processor: A2uiRequestProcessor, text: str) -> str:
    blocks = [
        raw.part.a2ui_raw
        for raw in processor.parser.unwrap(text)
        if isinstance(raw.part, RawA2uiPart)
    ]
    if not blocks:
        raise ValueError("The reply holds no block.")
    return blocks[0]


def write(directory: Path, name: str, content: str) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    (directory / name).write_text(content, encoding="utf-8")
    print(f"wrote {directory / name}")


def record(client: genai.Client, out: Path, format_name: str) -> None:
    processor = A2uiRequestProcessor(
        [BasicCatalog("v1.0")], format_factory=FACTORIES[format_name]()
    )
    prompt = processor.prompt_snippet
    for attempt in range(1, ATTEMPTS + 1):
        chunks = ask(client, prompt)
        text = "".join(chunks)
        try:
            processor.parse_response(text)
            block = first_block(processor, text)
        except Exception as error:  # The SDK's error, or a reply with no block: ask again.
            print(
                f"{format_name}: attempt {attempt} did not parse: {type(error).__name__}: {error}",
                file=sys.stderr,
            )
            continue
        break
    else:
        raise SystemExit(f"{format_name}: no reply parsed in {ATTEMPTS} attempts.")
    ends = []
    end = 0
    for chunk in chunks:
        end += utf16_length(chunk)
        ends.append(end)
    write(out / f"{format_name}_parse_response", "text.txt", text)
    if format_name in STREAMED:
        write(out / f"{format_name}_open_stream", "text.txt", text)
        write(out / f"{format_name}_open_stream", "chunks.json", json.dumps(ends) + "\n")
    write(out / f"{format_name}_compile", "text.txt", block)
    if format_name == "express":
        for case in [
            "express_parse_response_unwrapped",
            "tool_call_without_state",
            "tool_call_with_state",
        ]:
            write(out / case, "text.txt", block)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--format", choices=sorted(FACTORIES), action="append")
    args = parser.parse_args()
    key = os.environ.get("GOOGLE_API_KEY")
    if not key:
        raise SystemExit("Set GOOGLE_API_KEY.")
    client = genai.Client(api_key=key)
    for format_name in args.format or list(FACTORIES):
        record(client, args.out, format_name)


if __name__ == "__main__":
    main()
