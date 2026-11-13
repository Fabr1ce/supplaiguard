"""CLI: python -m storyteller [--no-crypt]"""
import sys

from .agent import storyteller

BANNER = "🎃 The Haunted Storyteller — type a mood or a request ('quit' to leave the crypt)"


def main() -> int:
    with_crypt = "--no-crypt" not in sys.argv
    print(BANNER)
    with storyteller(with_crypt=with_crypt) as agent:
        while True:
            try:
                line = input("\n👻 you> ").strip()
            except (EOFError, KeyboardInterrupt):
                break
            if line.lower() in {"quit", "exit"}:
                break
            if line:
                agent(line)
    print("\nSleep tight... 🕸️")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
