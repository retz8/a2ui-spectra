"""Copies LiteLLM's price table at a release into the tool, trimmed to the three providers the model proxy
reads in full, for the estimated cost the viewer shows.

It reads `model_prices_and_context_window.json` and `LICENSE` from BerriAI/litellm at the release's tag,
and the release's date from GitHub's API, with curl, then writes under tools/spectra/src/prices/:

- model_prices_and_context_window.json: the entries whose `litellm_provider` is `gemini`, `anthropic` or
  `openai`, each whole and in the release's order;
- release.json: the release's tag and date;
- NOTICE: the release, its date, and LiteLLM's MIT licence text.

From the repository root, with the release's tag:

    python3 -I _dev/tools/copy_litellm_prices.py v1.106.6
"""

import json
import subprocess
import sys
from pathlib import Path

REPOSITORY = "BerriAI/litellm"
PROVIDERS = ("gemini", "anthropic", "openai")
OUT = Path(__file__).resolve().parents[2] / "tools/spectra/src/prices"


def fetch(url):
    """The body at a URL, through curl, which uses the system's certificates."""
    return subprocess.run(["curl", "-sSfL", url], check=True, capture_output=True).stdout.decode("utf-8")


def raw(tag, path):
    return fetch(f"https://raw.githubusercontent.com/{REPOSITORY}/{tag}/{path}")


def mit_text(licence):
    """The MIT part of LiteLLM's licence, which covers everything outside its enterprise/ directory."""
    start = licence.index("MIT License")
    return licence[start:].strip() + "\n"


def main():
    if len(sys.argv) != 2:
        sys.exit("Give the release's tag, such as v1.106.6.")
    tag = sys.argv[1]
    release = json.loads(fetch(f"https://api.github.com/repos/{REPOSITORY}/releases/tags/{tag}"))
    date = release["published_at"][:10]
    table = json.loads(raw(tag, "model_prices_and_context_window.json"))
    trimmed = {
        key: entry
        for key, entry in table.items()
        if isinstance(entry, dict) and entry.get("litellm_provider") in PROVIDERS
    }
    licence = raw(tag, "LICENSE")

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "model_prices_and_context_window.json").write_text(
        json.dumps(trimmed, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    (OUT / "release.json").write_text(
        json.dumps({"release": tag, "date": date}, indent=2) + "\n", encoding="utf-8"
    )
    (OUT / "NOTICE").write_text(
        f"model_prices_and_context_window.json is LiteLLM's price table from {REPOSITORY}, release {tag},\n"
        f"published {date}, trimmed to the entries whose litellm_provider is {', '.join(PROVIDERS[:-1])} or "
        f"{PROVIDERS[-1]},\n"
        "each entry unchanged. It is used under LiteLLM's MIT licence:\n\n" + mit_text(licence),
        encoding="utf-8",
    )
    counts = {provider: sum(1 for e in trimmed.values() if e["litellm_provider"] == provider) for provider in PROVIDERS}
    print(f"{OUT}: {len(trimmed)} entries of {tag}, {date}: " + ", ".join(f"{p} {n}" for p, n in counts.items()))


if __name__ == "__main__":
    main()
