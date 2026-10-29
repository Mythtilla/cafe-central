#!/usr/bin/env python3
"""Build Café Central site.

- src/index.template.html  -> index.html       (external css/js/fonts)
- same template            -> cafe-central-standalone.html (everything inlined; live.js finds no API and leaves the static content alone)

Usage: python3 build.py
"""
import base64
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent
SRC = ROOT / "src"
SVG_DIR = ROOT / "assets" / "svg"
CSS = ROOT / "assets" / "css" / "style.css"


def svg(name: str) -> str:
    path = SVG_DIR / f"{name}.svg"
    if not path.exists():
        sys.exit(f"missing svg: {path}")
    text = path.read_text(encoding="utf-8").strip()
    text = re.sub(r"^<\?xml[^>]*>\s*", "", text)
    return text


def render(template: str) -> str:
    def repl(match: re.Match) -> str:
        return svg(match.group(1))
    return re.sub(r"\{\{SVG:([a-z0-9-]+)\}\}", repl, template)


def standalone(html: str) -> str:
    css = CSS.read_text(encoding="utf-8")
    for font in ["fraunces-latin", "fraunces-italic-latin", "intertight-latin"]:
        data = base64.b64encode((ROOT / "assets" / "fonts" / f"{font}.woff2").read_bytes()).decode()
        css = css.replace(f'url("../fonts/{font}.woff2")', f'url("data:font/woff2;base64,{data}")')

    icon = (ROOT / "assets" / "favicon.svg").read_text(encoding="utf-8")
    icon_b64 = base64.b64encode(icon.encode("utf-8")).decode()
    html = html.replace(
        '<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">',
        f'<link rel="icon" href="data:image/svg+xml;base64,{icon_b64}">',
    )

    html = re.sub(
        r'\s*<link rel="preload"[^>]*>', "", html
    )
    html = html.replace(
        '<link rel="stylesheet" href="assets/css/style.css">',
        f"<style>\n{css}\n</style>",
    )
    def inline_script(match: re.Match) -> str:
        code = (ROOT / "assets" / "js" / match.group(1)).read_text(encoding="utf-8")
        return f"<script>\n{code}\n</script>"

    html = re.sub(r'<script src="assets/js/([a-z]+\.js)" defer></script>', inline_script, html)
    return html


def main() -> None:
    template = (SRC / "index.template.html").read_text(encoding="utf-8")
    html = render(template)

    if "{{SVG:" in html:
        sys.exit("unreplaced svg placeholder remains")

    (ROOT / "index.html").write_text(html, encoding="utf-8")
    (ROOT / "cafe-central-standalone.html").write_text(standalone(html), encoding="utf-8")

    for name in ["index.html", "cafe-central-standalone.html"]:
        size = (ROOT / name).stat().st_size
        print(f"{name:34} {size/1024:8.1f} KB")
    print("ok")


if __name__ == "__main__":
    main()
