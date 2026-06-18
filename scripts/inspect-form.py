import json, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

fn = r"C:/Users/Administrator/.openclaw/agents/main/sessions/ee6fcdf2-bcdf-4dff-be73-868a5b985698.jsonl"
lines = open(fn, encoding="utf-8").read().splitlines()

# Find the LAST occurrence of the full-form task ("fill out the ENTIRE form")
start = 0
for i, l in enumerate(lines):
    if "ENTIRE form" in l:
        start = i
calls = acts = snaps = 0
final = ""
running = False
for l in lines[start:]:
    try:
        p = json.loads(l)
    except Exception:
        continue
    m = p.get("message", {})
    for c in (m.get("content") or []):
        t = c.get("type")
        if t == "toolCall":
            calls += 1
            a = c.get("arguments", {})
            act = a.get("action", "")
            if act == "act":
                acts += 1
                req = a.get("request", {})
                print(f"  ACT: {req.get('kind','')} ref={req.get('ref','')} {str(req.get('text',''))[:40]}")
            elif act == "snapshot":
                snaps += 1
                print("  SNAPSHOT")
            else:
                print(f"  {act}")
        if t == "text" and m.get("role") == "assistant" and c.get("text", "").strip():
            final = c["text"]
    sr = m.get("stopReason")
    if sr and sr != "toolUse":
        print(f"  [stop={sr}]")

print(f"\nTotals: calls={calls} acts={acts} snaps={snaps}")
print("=== LATEST ASSISTANT TEXT ===")
print(final[:1500])
