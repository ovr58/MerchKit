#!/usr/bin/env python3
"""Mine past agent-session transcripts for evidence. Costs zero model tokens.

Transcripts are JSONL — one message per line. Tool calls live in
`message.content[]` as `{"type": "tool_use", "id", "name", "input"}` and their
outcomes as `{"type": "tool_result", "tool_use_id", "is_error", "content"}`,
usually in the *next* line. This stitches them by `tool_use_id` and aggregates.

Usage
-----
  python mine.py --dir <TRANSCRIPT_DIR> --tool '^mcp__figma'      # by tool name
  python mine.py --dir <TRANSCRIPT_DIR> --text 'migration|drizzle' # by message text
  python mine.py --dir <TRANSCRIPT_DIR> --tool Bash --out ./scratch

Outputs `calls.jsonl` (one record per matched call) and `stats.txt` next to
`--out`. Read stats.txt first; open calls.jsonl only for the slices it points at.
"""
import argparse
import json
import os
import re
import sys
from collections import Counter

if hasattr(sys.stdout, "reconfigure"):  # transcripts are UTF-8; consoles often are not
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def result_text(content):
    """tool_result.content is a string, or a list of blocks."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        out = []
        for b in content:
            out.append(b.get("text") or json.dumps(b, ensure_ascii=False)
                       if isinstance(b, dict) else str(b))
        return "\n".join(out)
    return "" if content is None else json.dumps(content, ensure_ascii=False)


def iter_messages(path):
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue  # a truncated tail line is normal


def mine_tools(files, pattern):
    """Stitch tool_use to its tool_result. Returns records in call order."""
    calls, order, results = {}, [], {}
    for path in files:
        last_text = ""
        for d in iter_messages(path):
            content = (d.get("message") or {}).get("content")
            if not isinstance(content, list):
                continue
            for b in content:
                if not isinstance(b, dict):
                    continue
                if b.get("type") == "text":
                    last_text = (b.get("text") or "")[-400:]
                elif b.get("type") == "tool_use" and pattern.search(str(b.get("name", ""))):
                    calls[b.get("id")] = {
                        "session": os.path.basename(path)[:8],
                        "ts": d.get("timestamp"),
                        "branch": d.get("gitBranch"),
                        "tool": b.get("name"),
                        "input": b.get("input") or {},
                        "intent": last_text,
                    }
                    order.append(b.get("id"))
                elif b.get("type") == "tool_result" and b.get("tool_use_id") in calls:
                    results[b["tool_use_id"]] = (bool(b.get("is_error")),
                                                 result_text(b.get("content")))
    recs = []
    for tid in order:
        r = calls[tid]
        is_err, txt = results.get(tid, (None, ""))
        r.update(is_error=is_err, result_len=len(txt), result_head=txt[:600])
        recs.append(r)
    return recs


def mine_text(files, pattern):
    """Messages whose text matches. Use when the topic is not one tool."""
    recs, seen = [], set()
    for path in files:
        for d in iter_messages(path):
            msg = d.get("message") or {}
            content = msg.get("content")
            txt = content if isinstance(content, str) else " ".join(
                b.get("text", "") for b in content or []
                if isinstance(b, dict) and b.get("type") == "text")
            txt = (txt or "").strip()
            if not txt or not pattern.search(txt) or txt[:80] in seen:
                continue
            seen.add(txt[:80])
            recs.append({"session": os.path.basename(path)[:8], "ts": d.get("timestamp"),
                         "branch": d.get("gitBranch"), "role": msg.get("role"),
                         "tool": "(text)", "input": {}, "is_error": None,
                         "result_len": len(txt), "result_head": txt[:900]})
    return recs


def report(recs, mode):
    L = ["MATCHED: %d records in %d sessions"
         % (len(recs), len({r["session"] for r in recs}))]
    if not recs:
        return "\n".join(L + ["", "Nothing matched. Widen the pattern or check --dir."])

    if mode == "tools":
        by_tool = Counter(r["tool"] for r in recs)
        errs = Counter(r["tool"] for r in recs if r["is_error"])
        L.append("\n== BY TOOL (calls / errors / no result) ==")
        for t, n in by_tool.most_common(25):
            nores = sum(1 for r in recs if r["tool"] == t and r["is_error"] is None)
            L.append("%-40s %5d  err=%-4d nores=%d" % (t, n, errs[t], nores))

        L.append("\n== ERROR TEXTS (first line, by frequency) ==")
        c = Counter((r["tool"], (r["result_head"].strip().splitlines() or [""])[0][:160])
                    for r in recs if r["is_error"])
        for (t, head), n in c.most_common(50):
            L.append("%3dx [%s] %s" % (n, t, head))

        L.append("\n== HEAVIEST RESULTS (context burn) ==")
        for r in sorted(recs, key=lambda x: -x["result_len"])[:20]:
            L.append("%9d B  [%s] %s" % (r["result_len"], r["session"], r["tool"]))
        total = sum(r["result_len"] for r in recs)
        top = sum(r["result_len"] for r in sorted(recs, key=lambda x: -x["result_len"])[:20])
        L.append("total %.1f MB; top-20 = %.0f%%" % (total / 1e6, 100 * top / max(total, 1)))

        L.append("\n== CONSECUTIVE RUNS (same tool 3+ in a row: retry thrash) ==")
        runs, prev, run = [], (None, None), 0
        for r in recs:
            if (r["session"], r["tool"]) == prev:
                run += 1
            else:
                if run >= 3:
                    runs.append((run,) + prev)
                prev, run = (r["session"], r["tool"]), 1
        if run >= 3:
            runs.append((run,) + prev)
        for n, s, t in sorted(runs, reverse=True)[:20]:
            L.append("%3d in a row  [%s] %s" % (n, s, t))

    L.append("\n== PER DAY ==")
    for day, n in sorted(Counter((r["ts"] or "")[:10] for r in recs).items()):
        L.append("%s  %5d" % (day, n))
    L.append("\n== BRANCHES ==")
    for br, n in Counter(r["branch"] or "?" for r in recs).most_common(15):
        L.append("%-44s %5d" % (br, n))
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True, help="directory holding *.jsonl transcripts")
    ap.add_argument("--tool", help="regex on tool name (search, not fullmatch)")
    ap.add_argument("--text", help="regex on message text; use when the topic is not one tool")
    ap.add_argument("--out", default=".", help="where to write calls.jsonl and stats.txt")
    a = ap.parse_args()
    if bool(a.tool) == bool(a.text):
        ap.error("give exactly one of --tool / --text")

    files = sorted(os.path.join(a.dir, f) for f in os.listdir(a.dir) if f.endswith(".jsonl"))
    if not files:
        ap.error("no *.jsonl in %s" % a.dir)
    pat = re.compile(a.tool or a.text, re.I)
    recs = mine_tools(files, pat) if a.tool else mine_text(files, pat)

    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, "calls.jsonl"), "w", encoding="utf-8") as f:
        for r in recs:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    out = report(recs, "tools" if a.tool else "text")
    with open(os.path.join(a.out, "stats.txt"), "w", encoding="utf-8") as f:
        f.write(out)
    print(out[:4000])
    print("\nscanned %d transcripts -> %s" % (len(files), os.path.abspath(a.out)))


if __name__ == "__main__":
    main()
