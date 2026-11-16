#!/usr/bin/env python3
"""Build the standalone JinGu Qunxiazhuan save editor HTML bundle."""

from __future__ import annotations

import hashlib
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import NoReturn

ROOT = Path(__file__).resolve().parent
SRC_DIR = ROOT / "src"
DIST_DIR = ROOT / "dist"
PAGE_PATH = SRC_DIR / "editor-page.html"
OUTPUT_PATH = DIST_DIR / "JinGuSaveEditor-v1.0.html"

SCRIPT_NAMES = [
    "jingu-codec.js",
    "catalog-data.js",
    "editor-core.js",
    "editor-ui.js",
]

MAX_BUNDLE_BYTES = 10 * 1024 * 1024
HANZI_RE = re.compile(r"[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]")
EXTERNAL_SCRIPT_SRC_RE = re.compile(
    r"<script\b[^>]*\bsrc\s*=\s*(?:\"[^\"]*\"|'[^']*'|[^\s>]+)",
    re.IGNORECASE,
)
EXTERNAL_URL_RE = re.compile(
    r"(?i)(?:https?://|ftp://|wss?://|(?<!:)//[A-Za-z0-9])"
)
INLINE_MARKER_RE = re.compile(
    r"<!--\s*INLINE_SCRIPTS\s*-->|<!--\s*BUNDLE_SCRIPTS\s*-->|<!--\s*SCRIPTS\s*-->",
    re.IGNORECASE,
)


def fail(message: str) -> NoReturn:
    print(f"build.py: error: {message}", file=sys.stderr)
    raise SystemExit(1)


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        fail(f"missing file: {path}")
    except UnicodeDecodeError as exc:
        fail(f"file is not valid UTF-8: {path}: {exc}")


def resolve_script_path(name: str) -> Path:
    for candidate in (SRC_DIR / name, ROOT / name):
        if candidate.is_file():
            return candidate
    fail(f"missing script: {name}")


def escape_inline_script(js: str) -> str:
    return re.sub(r"</script", r"<\\/script", js, flags=re.IGNORECASE)


def make_inline_block(scripts: list[tuple[str, str]]) -> str:
    parts: list[str] = []
    for name, source in scripts:
        escaped = escape_inline_script(source)
        parts.append(f"<script>\n/* {name} */\n{escaped}\n</script>")
    return "\n".join(parts)


def remove_named_external_script_tags(html: str, names: list[str]) -> str:
    for name in names:
        escaped_name = re.escape(name)
        pattern = re.compile(
            r"<script\b[^>]*\bsrc\s*=\s*(?:\"[^\"]*"
            + escaped_name
            + r"[^\"]*\"|'[^']*"
            + escaped_name
            + r"[^']*'|[^\s>]*"
            + escaped_name
            + r"[^\s>]*)[^>]*>\s*</script\s*>",
            re.IGNORECASE,
        )
        html = pattern.sub("", html)
    return html


def inject_inline_scripts(html: str, inline_block: str) -> str:
    if INLINE_MARKER_RE.search(html):
        return INLINE_MARKER_RE.sub(lambda _m: inline_block, html, count=1)
    body_close = re.search(r"</body\s*>", html, re.IGNORECASE)
    if body_close:
        return html[: body_close.start()] + inline_block + "\n" + html[body_close.start() :]
    html_close = re.search(r"</html\s*>", html, re.IGNORECASE)
    if html_close:
        return html[: html_close.start()] + inline_block + "\n" + html[html_close.start() :]
    return html + "\n" + inline_block + "\n"


def build_html() -> str:
    page = read_text(PAGE_PATH)
    scripts = [(name, read_text(resolve_script_path(name))) for name in SCRIPT_NAMES]
    inline_block = make_inline_block(scripts)
    page = remove_named_external_script_tags(page, SCRIPT_NAMES)
    page = inject_inline_scripts(page, inline_block)

    if EXTERNAL_SCRIPT_SRC_RE.search(page):
        match = EXTERNAL_SCRIPT_SRC_RE.search(page)
        fail(f"external <script src=...> remains in bundled HTML: {match.group(0)!r}")

    if EXTERNAL_URL_RE.search(page):
        match = EXTERNAL_URL_RE.search(page)
        start = max(0, match.start() - 80)
        end = min(len(page), match.end() + 80)
        fail(f"external URL remains in bundled HTML near: {page[start:end]!r}")

    hanzi = HANZI_RE.search(page)
    if hanzi:
        fail(f"Hanzi character remains in bundled HTML: {hanzi.group(0)!r} at offset {hanzi.start()}")

    data = page.encode("utf-8")
    if len(data) >= MAX_BUNDLE_BYTES:
        fail(f"bundle size {len(data)} bytes is not below {MAX_BUNDLE_BYTES} bytes")

    return page


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, path)
    except BaseException:
        try:
            tmp_path.unlink()
        except FileNotFoundError:
            pass
        raise


def main() -> None:
    html = build_html()
    data = html.encode("utf-8")
    atomic_write(OUTPUT_PATH, data)
    digest = hashlib.sha256(data).hexdigest()
    print(f"output: {OUTPUT_PATH}")
    print(f"bytes: {len(data)}")
    print(f"sha256: {digest}")


if __name__ == "__main__":
    main()
