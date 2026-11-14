#!/usr/bin/env python3
"""Rebuild the SupplAIGuard logo files from assets/logo-mark.svg (the source of truth for the head).

Writes logo.svg, logo-loop.svg and social-preview.svg. PNG renders are produced when `cairosvg`
is installed:  uv pip install cairosvg && python3 assets/build_logo.py
"""
import math
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
FONT = "DejaVu Sans, Verdana, Helvetica, Arial, sans-serif"
BG = "#120f1a"

# The five stages of the loop. Learn is what feeds results back into Discover.
STAGES = [
    ("Discover", "#8fd36b"),
    ("Analyze", "#4dd0c4"),
    ("Remediate", "#7c8cff"),
    ("Verify", "#a265ff"),
    ("Learn", "#ff9f43"),
]
CX, CY, R, NODE_R = 190, 178, 118, 12


def mark_group() -> str:
    src = (HERE / "logo-mark.svg").read_text()
    m = re.search(r'<g id="mark">.*</g>', src, re.S)
    if not m:
        raise SystemExit("logo-mark.svg must contain <g id=\"mark\">")
    return m.group(0)


def pt(theta_deg: float, r: float = R):
    t = math.radians(theta_deg)
    return CX + r * math.cos(t), CY + r * math.sin(t)


def arrow(theta_end: float, color: str, size: float = 9) -> str:
    """Triangle whose tip sits on the ring at theta_end, pointing clockwise (direction of travel)."""
    t = math.radians(theta_end)
    tip = pt(theta_end)
    tx, ty = -math.sin(t), math.cos(t)  # tangent, clockwise on screen
    nx, ny = math.cos(t), math.sin(t)
    b = (tip[0] - tx * size, tip[1] - ty * size)
    p1 = (b[0] + nx * size * 0.55, b[1] + ny * size * 0.55)
    p2 = (b[0] - nx * size * 0.55, b[1] - ny * size * 0.55)
    return f'<polygon points="{tip[0]:.1f},{tip[1]:.1f} {p1[0]:.1f},{p1[1]:.1f} {p2[0]:.1f},{p2[1]:.1f}" fill="{color}"/>'


def loop() -> str:
    n = len(STAGES)
    step = 360 / n
    gap = math.degrees((NODE_R + 8) / R)  # keep arcs clear of the nodes
    out = ['<g id="loop" fill="none">']
    # soft guide ring
    out.append(f'<circle cx="{CX}" cy="{CY}" r="{R}" stroke="#2a2440" stroke-width="2" stroke-dasharray="2 7"/>')
    for i, (_, color) in enumerate(STAGES):
        a0 = -90 + i * step + gap
        a1 = -90 + (i + 1) * step - gap
        sx, sy = pt(a0)
        ex, ey = pt(a1 - 2.2)  # stop just short of the arrowhead tip
        w = 5 if i == n - 1 else 4  # the Learn -> Discover return arrow is the new part: make it bolder
        out.append(f'<path d="M{sx:.1f},{sy:.1f} A{R},{R} 0 0 1 {ex:.1f},{ey:.1f}" stroke="{color}" '
                   f'stroke-width="{w}" stroke-linecap="round"/>')
        out.append(arrow(a1, color))
    for i, (name, color) in enumerate(STAGES):
        theta = -90 + i * step
        x, y = pt(theta)
        out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{NODE_R}" fill="{color}" stroke="{BG}" stroke-width="3"/>')
        out.append(f'<text x="{x:.1f}" y="{y + 4.6:.1f}" text-anchor="middle" font-family="{FONT}" font-size="13" '
                   f'font-weight="800" fill="{BG}">{i + 1}</text>')
        lx, ly = pt(theta, R + 24)
        c, s = math.cos(math.radians(theta)), math.sin(math.radians(theta))
        anchor = "start" if c > 0.3 else "end" if c < -0.3 else "middle"
        dy = 11 if s > 0.5 else (-2 if s < -0.5 else 5)
        out.append(f'<text x="{lx:.1f}" y="{ly + dy:.1f}" text-anchor="{anchor}" font-family="{FONT}" font-size="15" '
                   f'font-weight="700" fill="{color}">{name}</text>')
    out.append("</g>")
    return "\n".join(out)


def emblem() -> str:
    # the head, centred inside the ring (mark is 200x220, scaled 0.8)
    return loop() + f'<g transform="translate({CX - 80},{CY - 88}) scale(0.8)">{mark_group()}</g>'


def word(x, y, size, tag):
    return (f'<text x="{x}" y="{y}" font-family="{FONT}" font-size="{size}" font-weight="800" fill="#e8e4f0">'
            f'Suppl<tspan fill="#ff9f43">AI</tspan>Guard</text>'
            f'<text x="{x + 3}" y="{y + tag * 2.2:.0f}" font-family="{FONT}" font-size="{tag}" fill="#9a93ad">'
            f'Secure locally. Verify continuously. Ship confidently.</text>')


def svg(w, h, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" '
            f'aria-labelledby="t d"><title id="t">SupplAIGuard</title>'
            f'<desc id="d">A stitched green and purple ghost-hem shield with a Frankenstein flat head, inside a five-step loop: '
            f'Discover, Analyze, Remediate, Verify, Learn, and back to Discover.</desc>'
            f'<rect width="{w}" height="{h}" rx="{min(w, h) // 12}" fill="{BG}"/>{body}</svg>\n')


def main():
    (HERE / "logo.svg").write_text(svg(940, 350, emblem() + word(450, 182, 56, 16)))
    (HERE / "logo-loop.svg").write_text(svg(420, 350, emblem()))
    (HERE / "social-preview.svg").write_text(
        svg(1280, 640, f'<g transform="translate(40,60) scale(1.45)">{emblem()}</g>' + word(655, 322, 62, 18)))
    try:
        import cairosvg
    except ImportError:
        print("SVGs written (install cairosvg to also render PNGs)")
        return
    cairosvg.svg2png(url=str(HERE / "logo.svg"), write_to=str(HERE / "logo.png"), scale=2)
    cairosvg.svg2png(url=str(HERE / "logo-loop.svg"), write_to=str(HERE / "logo-loop.png"), scale=2)
    cairosvg.svg2png(url=str(HERE / "social-preview.svg"), write_to=str(HERE / "social-preview.png"))
    print("SVGs and PNGs written")


if __name__ == "__main__":
    main()
