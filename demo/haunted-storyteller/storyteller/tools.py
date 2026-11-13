"""Local Strands tools for the Haunted Storyteller (pure + unit-testable)."""
from __future__ import annotations

import random
import re
from pathlib import Path

from jinja2 import Template
from strands import tool

STORIES_DIR = Path("stories")

GAUGE = ["🕯️ cozy", "🎃 spooky", "👻 eerie", "🩸 terrifying", "💀 nightmare"]

TITLE_CARD = Template(
    "╔══════════════════════════════╗\n"
    "  {{ title|upper }}\n"
    "  fright level: {{ gauge }}\n"
    "╚══════════════════════════════╝"
)


def _slug(title: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return slug[:60] or "untitled"


@tool
def fright_meter(mood: str) -> str:
    """Convert a listener's mood into a fright level from 1 (cozy) to 5 (nightmare).

    Args:
        mood: Free text such as "brave", "nervous", "kids are listening".
    """
    m = mood.lower()
    if any(w in m for w in ("kid", "child", "nervous", "scared", "cozy")):
        return "1"
    if any(w in m for w in ("brave", "bold", "fearless", "nightmare")):
        return "5" if "nightmare" in m else "4"
    return str(random.Random(m).randint(2, 3))


@tool
def title_card(title: str, fright: int) -> str:
    """Render an ASCII title card for a story.

    Args:
        title: The story title.
        fright: Fright level 1-5.
    """
    level = min(5, max(1, int(fright)))
    return TITLE_CARD.render(title=title, gauge=GAUGE[level - 1])


@tool
def save_story(title: str, body: str) -> str:
    """Save a finished story to the local stories/ folder and return its path.

    Args:
        title: The story title (used for the filename).
        body: The full story text.
    """
    STORIES_DIR.mkdir(parents=True, exist_ok=True)
    path = (STORIES_DIR / f"{_slug(title)}.md").resolve()
    if STORIES_DIR.resolve() not in path.parents:  # defence in depth against traversal
        raise ValueError("refusing to write outside the stories directory")
    path.write_text(f"# {title}\n\n{body}\n", encoding="utf-8")
    return str(path)


LOCAL_TOOLS = [fright_meter, title_card, save_story]
