#!/usr/bin/env python3
"""Preprocess Markdown for xPoster/X Article imports.

Usage:
    python3 preprocess.py article.md \
      --base-url https://example.com/blog/post/ \
      --h3-as-bold \
      -o article.xposter.md

This script is intentionally dependency-free and handles only general Markdown
rewrites that are safer to perform before xPoster parses a draft. Blog-specific
content edits, such as author byline rewrites or replacing one embedded post
with another, are deliberately out of scope.

The preprocessor can:
    - strip HTML comments outside fenced code blocks
    - make relative Markdown links/images absolute when --base-url is supplied
    - convert inline code spans to Unicode monospace text
    - keep protective code spans around converted identifiers containing "_", so
      xPoster consumes the backticks before its underscore/emphasis parser runs
    - normalize code-fence language aliases to labels X commonly highlights,
      including c++ -> cpp
    - optionally convert H3 headings to bold paragraphs with --h3-as-bold

X does not publish a complete official Article code-highlighting language list,
so language aliases are conservative and can be inspected with:
    python3 preprocess.py --list-language-aliases
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from urllib.parse import urljoin, urlparse


MONO_UPPER_A = ord("\U0001D670")
MONO_LOWER_A = ord("\U0001D68A")
MONO_DIGIT_0 = ord("\U0001D7F6")

FENCE_OPEN_RE = re.compile(r"^([ \t]{0,3})(`{3,}|~{3,})([^\n]*)$")

# X does not publish an official complete language list for Article code
# highlighting. These aliases normalize common Markdown fence labels to labels
# that are widely recognized by X/highlighter-style code blocks. Unknown labels
# are left unchanged.
DEFAULT_LANGUAGE_ALIASES: dict[str, str] = {
    "c++": "cpp",
    "cc": "cpp",
    "cxx": "cpp",
    "h++": "cpp",
    "hh": "cpp",
    "hpp": "cpp",
    "c#": "csharp",
    "cs": "csharp",
    "f#": "fsharp",
    "fs": "fsharp",
    "fsi": "fsharp",
    "fsx": "fsharp",
    "js": "javascript",
    "mjs": "javascript",
    "cjs": "javascript",
    "node": "javascript",
    "ts": "typescript",
    "py": "python",
    "py3": "python",
    "python3": "python",
    "rb": "ruby",
    "rs": "rust",
    "golang": "go",
    "kt": "kotlin",
    "kts": "kotlin",
    "objc": "objectivec",
    "objective-c": "objectivec",
    "sh": "bash",
    "shell": "bash",
    "zsh": "bash",
    "terminal": "bash",
    "console": "bash",
    "ps1": "powershell",
    "yml": "yaml",
    "docker": "dockerfile",
    "make": "makefile",
    "mk": "makefile",
    "md": "markdown",
}


def monospace_text(value: str) -> str:
    output: list[str] = []
    for char in value:
        if "A" <= char <= "Z":
            output.append(chr(MONO_UPPER_A + ord(char) - ord("A")))
        elif "a" <= char <= "z":
            output.append(chr(MONO_LOWER_A + ord(char) - ord("a")))
        elif "0" <= char <= "9":
            output.append(chr(MONO_DIGIT_0 + ord(char) - ord("0")))
        elif char == "*":
            # Avoid creating Markdown emphasis syntax after backticks are gone.
            output.append("\u2217")
        else:
            output.append(char)
    return "".join(output)


def fence_close_re(marker: str) -> re.Pattern[str]:
    return re.compile(rf"^[ \t]{{0,3}}{re.escape(marker[0])}{{{len(marker)},}}[ \t]*$")


def normalize_base_url(base_url: str | None) -> str | None:
    if not base_url:
        return None
    return base_url if base_url.endswith("/") else f"{base_url}/"


def is_absolute_or_special_target(target: str) -> bool:
    value = target.strip()
    parsed = urlparse(value)
    return bool(parsed.scheme or parsed.netloc or value.startswith("#") or value.startswith("//"))


def strip_html_comments_outside_fences(markdown: str) -> str:
    lines = markdown.splitlines(keepends=True)
    output: list[str] = []
    in_fence = False
    close_re: re.Pattern[str] | None = None
    in_comment = False

    for original_line in lines:
        line = original_line

        if in_fence:
            output.append(line)
            if close_re and close_re.match(line.rstrip("\n\r")):
                in_fence = False
                close_re = None
            continue

        opener = FENCE_OPEN_RE.match(line.rstrip("\n\r"))
        if opener:
            output.append(line)
            in_fence = True
            close_re = fence_close_re(opener.group(2))
            continue

        rebuilt = []
        cursor = 0
        while cursor < len(line):
            if in_comment:
                end = line.find("-->", cursor)
                if end < 0:
                    cursor = len(line)
                    break
                cursor = end + 3
                in_comment = False
                continue

            start = line.find("<!--", cursor)
            if start < 0:
                rebuilt.append(line[cursor:])
                break

            rebuilt.append(line[cursor:start])
            end = line.find("-->", start + 4)
            if end < 0:
                in_comment = True
                cursor = len(line)
                break
            cursor = end + 3

        output.append("".join(rebuilt))

    return "".join(output)


def find_closing_bracket(text: str, start: int) -> int:
    escaped = False
    for index in range(start, len(text)):
        char = text[index]
        if escaped:
            escaped = False
            continue
        if char == "\\":
            escaped = True
            continue
        if char == "]":
            return index
    return -1


def find_closing_paren(text: str, start: int) -> int:
    escaped = False
    depth = 0
    for index in range(start, len(text)):
        char = text[index]
        if escaped:
            escaped = False
            continue
        if char == "\\":
            escaped = True
            continue
        if char == "(":
            depth += 1
            continue
        if char == ")":
            if depth == 0:
                return index
            depth -= 1
    return -1


def convert_inline_code_spans(
    text: str,
    *,
    mode: str,
    protect_underscores: bool,
) -> str:
    if mode == "keep":
        return text

    output: list[str] = []
    cursor = 0
    while cursor < len(text):
        start = text.find("`", cursor)
        if start < 0:
            output.append(text[cursor:])
            break

        marker_end = start
        while marker_end < len(text) and text[marker_end] == "`":
            marker_end += 1
        marker = text[start:marker_end]
        end = text.find(marker, marker_end)
        if end < 0:
            output.append(text[cursor:])
            break

        raw = text[marker_end:end]
        converted = raw if mode == "plain" else monospace_text(raw)
        output.append(text[cursor:start])
        if protect_underscores and "_" in raw:
            output.append(f"`{converted}`")
        else:
            output.append(converted)
        cursor = end + len(marker)

    return "".join(output)


def rewrite_markdown_links_and_code(
    line: str,
    *,
    base_url: str | None,
    inline_code_mode: str,
    protect_underscores: bool,
) -> str:
    output: list[str] = []
    cursor = 0

    while cursor < len(line):
        bracket = line.find("[", cursor)
        if bracket < 0:
            output.append(
                convert_inline_code_spans(
                    line[cursor:],
                    mode=inline_code_mode,
                    protect_underscores=protect_underscores,
                )
            )
            break

        is_image = bracket > 0 and line[bracket - 1] == "!"
        token_start = bracket - 1 if is_image else bracket
        label_start = bracket + 1
        label_end = find_closing_bracket(line, label_start)
        if label_end < 0 or label_end + 1 >= len(line) or line[label_end + 1] != "(":
            output.append(
                convert_inline_code_spans(
                    line[cursor : bracket + 1],
                    mode=inline_code_mode,
                    protect_underscores=protect_underscores,
                )
            )
            cursor = bracket + 1
            continue

        target_start = label_end + 2
        target_end = find_closing_paren(line, target_start)
        if target_end < 0:
            output.append(
                convert_inline_code_spans(
                    line[cursor : bracket + 1],
                    mode=inline_code_mode,
                    protect_underscores=protect_underscores,
                )
            )
            cursor = bracket + 1
            continue

        output.append(
            convert_inline_code_spans(
                line[cursor:token_start],
                mode=inline_code_mode,
                protect_underscores=protect_underscores,
            )
        )

        label = line[label_start:label_end]
        target = line[target_start:target_end].strip()
        converted_label = convert_inline_code_spans(
            label,
            mode=inline_code_mode,
            protect_underscores=False,
        )
        if base_url and not is_absolute_or_special_target(target):
            target = urljoin(base_url, target)

        prefix = "!" if is_image else ""
        output.append(f"{prefix}[{converted_label}]({target})")
        cursor = target_end + 1

    return "".join(output)


def normalize_fence_language(info: str, aliases: dict[str, str]) -> str:
    stripped = info.strip()
    if not stripped:
        return info

    leading = info[: len(info) - len(info.lstrip())]
    trailing = info[len(info.rstrip()) :]
    body = info.strip()
    parts = body.split(None, 1)
    language = parts[0]
    rest = f" {parts[1]}" if len(parts) > 1 else ""
    normalized = aliases.get(language.lower(), language)
    return f"{leading}{normalized}{rest}{trailing}"


def preprocess(markdown: str, options: argparse.Namespace) -> str:
    base_url = normalize_base_url(options.base_url)
    language_aliases = {} if options.no_default_language_aliases else dict(DEFAULT_LANGUAGE_ALIASES)
    for alias in options.language_alias:
        source, _, target = alias.partition("=")
        if not source or not target:
            raise SystemExit(f"invalid --language-alias {alias!r}; expected FROM=TO")
        language_aliases[source.lower()] = target

    if not options.keep_html_comments:
        markdown = strip_html_comments_outside_fences(markdown)

    output: list[str] = []
    in_fence = False
    close_re: re.Pattern[str] | None = None

    for line in markdown.splitlines():
        if in_fence:
            output.append(line)
            if close_re and close_re.match(line):
                in_fence = False
                close_re = None
            continue

        opener = FENCE_OPEN_RE.match(line)
        if opener:
            prefix, marker, info = opener.groups()
            if options.normalize_fence_languages:
                info = normalize_fence_language(info, language_aliases)
            output.append(f"{prefix}{marker}{info}")
            in_fence = True
            close_re = fence_close_re(marker)
            continue

        if options.h3_as_bold:
            heading = re.match(r"^(\s*)###\s+(.+?)\s*$", line)
            if heading:
                line = f"{heading.group(1)}**{heading.group(2)}**"

        output.append(
            rewrite_markdown_links_and_code(
                line,
                base_url=base_url,
                inline_code_mode=options.inline_code,
                protect_underscores=options.protect_underscores,
            )
        )

    return "\n".join(output).strip() + "\n"


def read_input(path: str | None) -> str:
    if not path or path == "-":
        return sys.stdin.read()
    return Path(path).read_text(encoding="utf-8")


def write_output(value: str, *, input_path: str | None, output_path: str | None, in_place: bool) -> None:
    if in_place:
        if not input_path or input_path == "-":
            raise SystemExit("--in-place requires an input file path")
        Path(input_path).write_text(value, encoding="utf-8")
        return

    if output_path:
        Path(output_path).write_text(value, encoding="utf-8")
        return

    sys.stdout.write(value)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Preprocess Markdown for xPoster/X Article imports.",
    )
    parser.add_argument("input", nargs="?", help="Markdown file to read; stdin is used when omitted or '-'.")
    parser.add_argument("-o", "--output", help="Write preprocessed Markdown to this file instead of stdout.")
    parser.add_argument("--in-place", action="store_true", help="Rewrite the input file in place.")
    parser.add_argument(
        "--base-url",
        help="Base URL used to resolve relative Markdown link/image targets. Omit to keep relative targets.",
    )
    parser.add_argument(
        "--inline-code",
        choices=["unicode", "plain", "keep"],
        default="unicode",
        help="How to rewrite inline code spans. Default: unicode.",
    )
    parser.add_argument(
        "--no-protect-underscores",
        dest="protect_underscores",
        action="store_false",
        help="Do not keep protective backticks around converted inline code containing underscores.",
    )
    parser.set_defaults(protect_underscores=True)
    parser.add_argument(
        "--keep-html-comments",
        action="store_true",
        help="Keep HTML comments. By default they are removed outside fenced code blocks.",
    )
    parser.add_argument(
        "--h3-as-bold",
        action="store_true",
        help="Convert ### headings to bold paragraphs, matching X exports where H3 is not distinct.",
    )
    parser.add_argument(
        "--no-normalize-fence-languages",
        dest="normalize_fence_languages",
        action="store_false",
        help="Keep fenced code language labels exactly as written.",
    )
    parser.set_defaults(normalize_fence_languages=True)
    parser.add_argument(
        "--no-default-language-aliases",
        action="store_true",
        help="Disable built-in code-fence language aliases.",
    )
    parser.add_argument(
        "--language-alias",
        action="append",
        default=[],
        metavar="FROM=TO",
        help="Add or override a code-fence language alias. Can be repeated.",
    )
    parser.add_argument(
        "--list-language-aliases",
        action="store_true",
        help="Print built-in code-fence language aliases and exit.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.list_language_aliases:
        for source, target in sorted(DEFAULT_LANGUAGE_ALIASES.items()):
            print(f"{source}={target}")
        return 0

    markdown = read_input(args.input)
    result = preprocess(markdown, args)
    write_output(result, input_path=args.input, output_path=args.output, in_place=args.in_place)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
