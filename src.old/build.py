#!/usr/bin/env python3
"""
GFC build script.

Generates GFC-standalone.html — a single, self-contained file with the CSS,
JavaScript, starting data, and logo all inlined — from the multi-file source
(index.html + css/ + js/ + assets/logo.png).

The multi-file version is the source of truth. Run this after any change to
index.html, css/style.css, js/app.js, or js/data.js to refresh the standalone.

Usage:
    python3 build.py
"""

import base64
import re
import pathlib

ROOT = pathlib.Path(__file__).parent


def main():
    html = (ROOT / "index.html").read_text()
    css = (ROOT / "css" / "style.css").read_text()
    data = (ROOT / "js" / "data.js").read_text()
    app = (ROOT / "js" / "app.js").read_text()

    logo_uri = "data:image/png;base64," + base64.b64encode(
        (ROOT / "assets" / "logo.png").read_bytes()
    ).decode()

    # Inline the stylesheet (lambda replacements avoid backslash-escape issues
    # when the file contents contain things like \d).
    html = re.sub(
        r'<link[^>]*rel="stylesheet"[^>]*href="css/style\.css"[^>]*>',
        lambda m: "<style>\n" + css + "\n</style>",
        html,
        count=1,
    )
    # Inline the scripts, data first then app (order matters).
    html = re.sub(
        r'<script[^>]*src="js/data\.js"[^>]*></script>',
        lambda m: "<script>\n" + data + "\n</script>",
        html,
        count=1,
    )
    html = re.sub(
        r'<script[^>]*src="js/app\.js"[^>]*></script>',
        lambda m: "<script>\n" + app + "\n</script>",
        html,
        count=1,
    )
    # Embed the logo as a data URI so the single file is self-contained.
    html = html.replace("assets/logo.png", logo_uri)

    # Safety checks
    assert "</script" not in css, "CSS would break out of the inlined <style>"
    assert "assets/logo.png" not in html, "unreplaced logo reference remains"

    out = ROOT / "GFC-standalone.html"
    out.write_text(html)
    print(f"Built {out.name}  ({len(html) // 1024} KB)")


if __name__ == "__main__":
    main()
