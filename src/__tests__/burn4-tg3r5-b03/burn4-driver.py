"""Run the unchanged traffic merger with guarded local files and synthetic time."""

import builtins
import io
import json
import os
from pathlib import Path
import sys
import tempfile
from datetime import datetime, timezone
from types import SimpleNamespace


def run(payload):
    output = io.StringIO()
    diagnostics = io.StringIO()
    events = []
    faults = payload.get("faults", {})
    ticks = payload.get("ticks", ["2026-10-22T02:00:00+00:00"])
    tick_index = 0
    with tempfile.TemporaryDirectory(prefix="burn4-b03-", dir="/tmp") as folder:
        root = Path(folder)
        aliases = {
            "traffic/history.json": root / "traffic/history.json",
            "/tmp/views.json": root / "tmp/views.json",
            "/tmp/clones.json": root / "tmp/clones.json",
            "/tmp/referrers.json": root / "tmp/referrers.json",
        }
        file_names = {
            "history": "traffic/history.json",
            "views": "/tmp/views.json",
            "clones": "/tmp/clones.json",
            "referrers": "/tmp/referrers.json",
        }
        for name, value in payload["files"].items():
            path = aliases[file_names[name]]
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(value, encoding="utf-8")

        def resolve(path):
            if path not in aliases:
                raise AssertionError("Source accessed an unapproved path")
            return aliases[path]

        class InterruptedWriter:
            def __init__(self, target, limit):
                self.target = target
                self.remaining = limit

            def __enter__(self):
                return self

            def __exit__(self, *args):
                self.target.close()

            def write(self, value):
                if len(value) <= self.remaining:
                    self.remaining -= len(value)
                    return self.target.write(value)
                self.target.write(value[: self.remaining])
                self.remaining = 0
                raise OSError("synthetic interrupted write")

        def guarded_open(path, mode="r"):
            target = resolve(path)
            events.append(["open", path, mode])
            if mode == "r" and path in faults.get("read", []):
                raise OSError("synthetic read failure")
            if mode not in ("r", "w"):
                raise AssertionError("Source used an unapproved file mode")
            if mode == "w":
                if path != "traffic/history.json":
                    raise AssertionError("Source wrote outside history")
                if faults.get("open_write"):
                    raise OSError("synthetic open failure")
            target_handle = builtins.open(target, mode, encoding="utf-8")
            if mode == "w" and "write_after_chars" in faults:
                return InterruptedWriter(target_handle, faults["write_after_chars"])
            return target_handle

        def exists(path):
            events.append(["exists", path])
            return resolve(path).exists()

        def makedirs(path, exist_ok=False):
            events.append(["makedirs", path, exist_ok])
            if path != "traffic" or exist_ok is not True:
                raise AssertionError("Source used an unapproved directory")
            if faults.get("mkdir"):
                raise OSError("synthetic directory failure")
            (root / path).mkdir(exist_ok=True)

        class Instant:
            def __init__(self, value):
                self.value = value

            def strftime(self, pattern):
                return self.value.strftime(pattern)

        class Clock:
            @staticmethod
            def now(zone):
                nonlocal tick_index
                if zone is not timezone.utc:
                    raise AssertionError("Source did not request UTC")
                value = datetime.fromisoformat(ticks[min(tick_index, len(ticks) - 1)])
                tick_index += 1
                if value.tzinfo is None:
                    raise AssertionError("Fixture clock must be timezone aware")
                return Instant(value.astimezone(timezone.utc))

        modules = {
            "json": json,
            "os": SimpleNamespace(path=SimpleNamespace(exists=exists), makedirs=makedirs),
            "sys": SimpleNamespace(stderr=diagnostics, stdout=output),
            "datetime": SimpleNamespace(datetime=Clock, timezone=timezone),
        }

        def guarded_import(name, _globals=None, _locals=None, fromlist=(), level=0):
            if level or name not in modules:
                raise AssertionError("Source requested an unapproved import")
            return modules[name]

        def capture_print(*args, **kwargs):
            kwargs.setdefault("file", output)
            return builtins.print(*args, **kwargs)

        safe_builtins = {
            name: getattr(builtins, name)
            for name in ["Exception", "isinstance", "list", "sum", "len"]
        }
        safe_builtins.update({"open": guarded_open, "__import__": guarded_import, "print": capture_print})
        scope = {"__builtins__": safe_builtins}
        error = None
        try:
            exec(compile(payload["source"], "traffic-workflow-heredoc", "exec"), scope)
        except Exception as problem:
            error = {"type": type(problem).__name__, "message": str(problem)}

        target = aliases["traffic/history.json"]
        result_text = target.read_text(encoding="utf-8") if target.exists() else None
        result_value = None
        parse_error = None
        if result_text is not None:
            try:
                result_value = json.loads(result_text)
            except (ValueError, TypeError) as problem:
                parse_error = type(problem).__name__
        return {
            "error": error,
            "stdout": output.getvalue(),
            "stderr": diagnostics.getvalue(),
            "events": events,
            "history": result_value,
            "historyText": result_text,
            "parseError": parse_error,
            "clockCalls": tick_index,
        }


if __name__ == "__main__":
    json.dump(run(json.load(sys.stdin)), sys.stdout)
    sys.stdout.write("\n")
