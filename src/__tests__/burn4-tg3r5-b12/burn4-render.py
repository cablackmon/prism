"""Render one unchanged Jinja override and parse output with standard libraries."""

import json
import os
import sys
from html.parser import HTMLParser
from pathlib import Path

import jinja2


class ParsedHead(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.meta = []
        self.scripts = []
        self.active_script = None

    def handle_starttag(self, tag, attrs):
        if tag == "meta":
            self.meta.append(dict(attrs))
        if tag == "script":
            self.active_script = {"attrs": dict(attrs), "text": ""}
            self.scripts.append(self.active_script)

    def handle_data(self, data):
        if self.active_script is not None:
            self.active_script["text"] += data

    def handle_endtag(self, tag):
        if tag == "script":
            self.active_script = None


def deny_external_operations(event, args):
    if event.startswith(("socket.", "subprocess.", "os.exec", "os.spawn", "os.posix_spawn")):
        raise RuntimeError("External operations are forbidden")
    if event in {"os.system", "os.remove", "os.rename", "os.mkdir", "os.rmdir"}:
        raise RuntimeError("Filesystem mutations are forbidden")
    if event == "open" and len(args) > 1:
        mode = args[1]
        if isinstance(mode, str) and any(flag in mode for flag in "wax+"):
            raise RuntimeError("Filesystem writes are forbidden")
        flags = args[2] if len(args) > 2 else 0
        writes = os.O_WRONLY | os.O_RDWR | os.O_APPEND | os.O_CREAT | os.O_TRUNC
        if isinstance(flags, int) and flags & writes:
            raise RuntimeError("Filesystem writes are forbidden")


def main():
    source_path = Path(__file__).resolve().parents[3] / "overrides" / "main.html"
    source = source_path.read_text(encoding="utf8")
    request = json.load(sys.stdin)
    sys.addaudithook(deny_external_operations)
    base = (
        "<!doctype html><html><head>"
        "{% block extrahead %}"
        '<meta name="burn4-base" content="inherited fixture">'
        "{% endblock %}</head><body></body></html>"
    )
    # These are the MkDocs 1.6.1 Theme.get_env constructor settings.
    environment = jinja2.Environment(
        loader=jinja2.DictLoader({"base.html": base, "main.html": source}),
        auto_reload=False,
    )
    template = environment.get_template("main.html")
    rendered = []
    for item in request["renders"]:
        output = template.render(config=item["config"], page=item.get("page"))
        parsed = ParsedHead()
        parsed.feed(output)
        parsed.close()
        schemas = []
        for script in parsed.scripts:
            if script["attrs"].get("type") != "application/ld+json":
                continue
            try:
                schemas.append({"data": json.loads(script["text"]), "error": None})
            except json.JSONDecodeError:
                schemas.append({"data": None, "error": "JSONDecodeError"})
        rendered.append({"meta": parsed.meta, "schemas": schemas})
    json.dump(
        {
            "engine": {
                "jinjaVersion": jinja2.__version__,
                "autoescape": environment.autoescape,
                "undefined": environment.undefined.__name__,
            },
            "renders": rendered,
        },
        sys.stdout,
        ensure_ascii=False,
    )


if __name__ == "__main__":
    main()
