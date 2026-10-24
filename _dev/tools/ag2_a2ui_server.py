"""Serves AG2's A2UI agent over A2A 1.0: ag2 1.2.1's A2UIAgentExecutor, in one A2UI version per run.

With --model scripted, AG2's scripted test model answers every turn with the same reply, so no key
is needed; --reply picks it. With --model gemini, Gemini answers, with GEMINI_API_KEY or
GOOGLE_API_KEY set. From the repository root:

    uv run --no-project --with "ag2[a2a,a2ui,gemini]==1.2.1" --with "a2a-sdk[http-server]==1.2.3" \\
        --with uvicorn --with sse-starlette \\
        python _dev/tools/ag2_a2ui_server.py --version v1.0 --model gemini --port 10016
"""

import argparse
import json

import uvicorn
from ag2 import Agent
from ag2.a2a import A2AServer, build_card
from ag2.a2ui.a2a import A2UIAgentExecutor, get_a2ui_agent_extension

CATALOGS = {
    "v0.9": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
    "v0.9.1": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
    "v1.0": "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
}

GEMINI_MODEL = "gemini-3.6-flash"


def scripted_reply(version, reply):
    """The scripted model's reply: a card, the card and a function call that wants a response, or a failure."""
    if reply == "fail":
        return RuntimeError("The scripted model failed.")
    messages = [
        {"version": version, "createSurface": {"surfaceId": "card", "catalogId": CATALOGS[version]}},
        {
            "version": version,
            "updateComponents": {
                "surfaceId": "card",
                "components": [
                    {"id": "root", "component": "Card", "child": "greeting"},
                    {"id": "greeting", "component": "Text", "text": "Hello from AG2"},
                ],
            },
        },
    ]
    if reply == "function_call":
        messages.append(
            {
                "version": version,
                "functionCallId": "open-docs",
                "wantResponse": True,
                "callFunction": {"call": "openUrl", "args": {"url": "https://a2ui.org"}},
            }
        )
    return "Here is your card.\n<a2ui-json>" + json.dumps(messages) + "</a2ui-json>"


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--version", choices=sorted(CATALOGS), default="v1.0", help="the A2UI version it serves")
    parser.add_argument("--model", choices=["scripted", "gemini"], default="scripted")
    parser.add_argument(
        "--reply",
        choices=["card", "function_call", "fail"],
        default="card",
        help="the scripted model's reply",
    )
    parser.add_argument("--port", type=int, default=10016)
    args = parser.parse_args()

    if args.model == "gemini":
        from ag2.config import GeminiConfig

        config = GeminiConfig(model=GEMINI_MODEL)
    else:
        from ag2.testing import TestConfig

        config = TestConfig(scripted_reply(args.version, args.reply))

    agent = Agent(
        name="ag2_a2ui_agent",
        prompt="Always answer with an A2UI surface: a Card holding the answer as Text components.",
        config=config,
    )
    executor = A2UIAgentExecutor(agent, protocol_version=args.version)
    url = f"http://127.0.0.1:{args.port}"
    card = build_card(
        agent,
        url=url,
        description="AG2's A2UI agent, answering with a card.",
        extensions=[get_a2ui_agent_extension(version=executor.protocol_version)],
    )
    app = A2AServer(agent, executor=executor).build_jsonrpc(url=url, card=card)
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
