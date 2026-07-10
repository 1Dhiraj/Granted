# OpenClaw — Product Strategy Conversation

A transcript of the discussion on what the product needs to improve to "do any task with
software," the reliability-vs-cost tradeoff, self-extension, and the AGI framing.

---

## 1. Q: My aim is that the product can do any task with software. What does it need to improve?

**Assessment (grounded in the project's own docs and memory):**

### The one thing standing between you and "do any task with software"
Across every doc written — `FIXES_PLAN.md`, `TOOL_CALLING_FLOW.md`, `BROWSER_TOOL_SCHEMA_TOGGLE.md`,
and the memory on browser task failures — the recurring blocker is the same: **the model doesn't
reliably emit the right action.** It hallucinates refs, skips navigate/snapshot, emits tool calls
as plain text, or stalls on forms.

That's not 5 problems. It's **one** problem: action reliability. "Do any task" is a *reliability*
claim, not a *capability* claim. The capabilities already exist (browser, desktop, voice,
multi-agent). What's missing is the thing that makes a user trust it with a real task unattended.

### Priority ranking
1. **Action reliability — the model→tool channel (highest leverage).** Route browser/desktop work
   to a computer-use model class (or a strong frontier model) + add a transport-level fallback that
   extracts a tool call when a model mis-channels it as text.
2. **Verification / "did it actually work?"** The biggest *missing* piece. The agent must check its
   own work (snapshot diff / expected-state check) before declaring done. Without this you can never
   run unattended.
3. **Recovery & self-correction.** A bounded retry-with-different-strategy loop — not the 164-call
   death spiral measured in the logs (only ~20 of 164 calls were real work). Reliability and cost
   are the same fix.
4. **Surface breadth (~40% of "any software").** Add terminal/CLI execution, filesystem operations,
   direct API calls, and a router that picks the cheapest reliable surface (API > CLI > DOM > vision).
5. **Cost economics.** Switch off the worst provider option; move to a caching-capable setup.
   Config-only, gates unit economics.
6. **Long-horizon tasks (planning + durable memory).** Task-level planning/checkpointing so a task
   that dies on step 7 of 12 can resume.
7. **Trust surface: observability & permissions.** A visible step log + permission gating, especially
   for the desktop tool that can control the whole machine.

### What I'd do, in order
1. Ship the cost fix (config-only).
2. Wire the reliable model for browser/desktop + transport fallback (kills the reliability blocker).
3. Add a verification step (makes "unattended" possible).

---

## 2. Q: Explain simply, I don't understand.

**Plain version:**

- **Your goal:** the product should do any task on a computer by itself — use websites, fill forms,
  click buttons, type — like a human assistant.
- **The main problem:** the "brain" (the AI model) often messes up the clicking and typing. It
  clicks the wrong thing, forgets to look at the page first, or *says* "I clicked the button" instead
  of actually clicking it. So the real problem isn't capability — it's **reliability.** A robot helper
  you can't trust isn't useful.

**What to fix, simplest first:**
1. **Use the right brain for the job** — a model built for clicking/typing on screens (or a strong
   frontier model), not a fumbling one. Fixes most clicking problems at once.
2. **Make it check its own work** — after it acts, confirm it actually worked; if not, try again.
   This is what lets people trust it to run alone.
3. **Make it cheaper** — it repeats itself a lot and uses a pricey provider; the fix is a settings
   change. Without this you lose money per customer.
4. **Let it do more kinds of tasks** — running commands, handling files, using a site's shortcuts.
   More surfaces = more tasks.

**One sentence:** the product can already *do* things — it just can't do them *reliably* yet. Fix
reliability first, then cost, then breadth.

---

## 3. Q: I agree with everything except the model suggestion — any frontier model with tool-call ability (GPT, Claude) can work for our goal.

**You're right, and your own evidence backs you up.**

- `TOOL_CALLING_FLOW.md` says exactly this: Claude/GPT understand tool schemas and emit clean tool
  calls; it was the **cheap/local models** (Ollama, etc.) that fumbled and emitted actions as text.
- `FIXES_PLAN.md` already says ref-based clicking is the right foundation.

So: frontier model + refs works. The computer-use suggestion was **one** way to get reliability
*cheaply* — a cost-saving trick, not a claim that frontier models can't do it.

**The real tension:**

| | Reliable clicking? | Cheap? |
|---|---|---|
| Claude / GPT-5 (frontier) | ✅ Yes | ❌ No (~$119/user/mo) |
| DeepSeek / local (cheap) | ❌ No | ✅ Yes |

So the real problem isn't "can the model do it" — that's won. It's: **frontier models are reliable
but expensive.**

**What this changes:**
- Reliability is mostly solved by the model itself. ✅
- Cost becomes the #1 problem, because you're now locked into the expensive model. The cost levers
  (caching, fewer calls, smaller snapshots) go from "nice to have" to **essential.**
- Verification still matters — smart ≠ perfect.

**One caveat:** frontier + refs wins on normal websites; weird pages (canvas, custom widgets,
image-only UIs) still need a screenshot as a **backup signal** — not a different model, just a
fallback for hard pages.

---

## 4. Q: Then how do we balance reliability and cost?

**Reframe: reliability and cost are not the same dial.**

Most people think there's one slider (cheap-dumb ↔ expensive-smart) and you pick a middle point.
That's the trap. There are **two dials**:
- **Which model** → sets reliability
- **How you feed the model** → sets cost

You can turn the *cost* dial without touching the *model* dial.

**The cost equation:**
```
cost  =  how many calls  ×  size of each call  ×  price per token
```
- **Price per token** ← forces a cheaper model. *Don't pull this — it costs reliability.*
- **Size of each call** ← caching + smaller snapshots. *Model stays the same.*
- **Number of calls** ← reliability itself. *Model stays the same.*

**Why it works:**
1. **Caching — the frontier model gets the discount too.** ~82% of each step repeats the previous
   step. Caching bills that repeated part at ~10% instead of 100% (GPT-5.4 cache-read $0.25 vs $2.50
   input; Claude Haiku $0.10 vs $1.00 — both ~90% off). You keep Claude/GPT *and* cut the bulk of the
   bill. Caching works on the expensive model — you don't need a cheap one for it.
2. **Reliability is itself a cost cut.** The logs measured 164 calls where only ~20 were real work.
   A reliable model that finishes in 7 calls instead of 164 is ~20× cheaper *per finished task*, even
   though each call costs more. "Expensive per call" ≠ "expensive per task."

**In numbers (project figures):**
- Frontier, naive: ~$119/user/mo ❌
- + caching (repeated 82% now ~10%): drops ~3–4×
- + reliability (fewer wasted calls): drops again
- + compact snapshots (the biggest token): drops again
- → affordable single-digit range on a $20 plan, *still on the frontier model.*

**Optional "later" lever — tiering:** split the work so a cheap model (or plain code) does the easy
parts (reading, summarizing, deterministic clicks) and the frontier model only handles hard decisions
and tricky actions. Pay frontier prices only on the ~20% that needs it. Optimization — do it after
caching + discipline.

**Simple version:** don't make the model cheaper. Make it **repeat itself less** (cache it) and
**fumble less** (reliability). Same smart model, a fraction of the bill.

---

## 5. Q: It needs abilities beyond clicking/typing — record and summarize a meeting without third-party apps. If it can't do something it should create skills, or the AI itself creates software/extensions to work with. The product should support extensions.

**Good news: most of this already exists in the codebase.**

- **Extensions: already done.** 100+ plugins in `extensions/` (browser, desktop, phone-control,
  voice-call, deepgram speech-to-text) plus a full plugin SDK. "Support extensions" → already the
  architecture.
- **Skill creation + a skill store: already there.** `skills-clawhub.ts` (registry),
  `skills-install.ts` (download/install), `skill-scanner.ts` (security-scans skills before use).
- **Sandboxed code execution: already there.** Security tests reference a Docker sandbox and an exec
  sandbox (`audit-exec-sandbox-host`, `audit-sandbox-docker-config`).

**Your vision has three levels:**

- **Level 1 — Capabilities beyond click/type (the meeting recorder).** ✅ mostly assembly. Capture
  system audio → transcribe (deepgram exists) → summarize (LLM exists). Only new bit: a small
  audio-capture tool. Each new capability is just another tool.
- **Level 2 — The AI saves what it figures out as a reusable skill.** 🔶 you have the machinery, need
  the loop. Today a human writes skills; next step is the agent saves a solved procedure as a named
  skill and replays it.
- **Level 3 — The AI writes actual code/software to fill a gap.** 🔴 the frontier. Splits into:
  - **Throwaway code in the sandbox** — write a short script, run it sandboxed, discard. Achievable
    now. Lower risk (ephemeral, sandboxed).
  - **Permanent self-written extension** — write a plugin, test it, scan it, register it, reuse it.
    Higher value, higher risk; needs scanner + tests + (at first) human approval.

**The key insight:** self-written code is the ultimate reliability+cost win. A 10-line script is
*more reliable* (deterministic, no fumbling) **and** *cheaper* (run once, no model loop) than 30
clicks. "The agent writes its own tools" is the **highest form** of the reliability-and-cost goal.

**The one hard constraint: security.** The moment an AI writes and runs its own code on a user's
machine, that's your biggest risk surface. Rule: self-written code stays **sandboxed + scanned +
permission-gated**, always. (You already take this seriously — scanner + sandboxes exist.)

**Roadmap — two genuinely new things (rest is assembly):**
1. **A code-execution tool in the sandbox** — lets the agent write+run throwaway scripts to fill any
   gap. Highest leverage: if no tool exists, it writes one.
2. **The self-authoring loop** — detect gap → write skill/code → test it → scan it → save or run.

**Simple version:** extensions and skills are built. The new superpower is letting the AI **write and
run its own code in a safe sandbox** when no tool exists. That turns "does browser tasks" into "does
any task" — and it's the cheapest, most reliable way to work.

---

## 6. Q: I want to create an AGI-level product — I can see I'm almost there.

**Honest answer (a real partner is honest, not just hype):**

**What's genuinely true:** you've built something real and ambitious — a self-extending agent platform
with 100+ plugins, a skills registry, sandboxed execution, browser/desktop/voice control. That's a
platform, not a toy.

**But two honest things about "AGI" and "almost there":**

1. **"AGI" is the wrong scoreboard — and it's a layer you don't own.** The *intelligence* comes from
   the frontier model (Claude/GPT), not your code. You're building the **body** (hands, eyes, memory)
   that lets the brain act — hugely valuable, but AGI isn't yours to ship. If it ever arrives, it
   arrives inside the model, and your product gets better automatically.

2. **"Almost there" is the feeling every agent builder has right before the hard part.** The demo
   works, so it *feels* 90% done. But the distance between "works in the demo" and "I can trust it to
   do any task unattended" is the **whole game** — the long tail: the differently-laid-out form, the
   page that didn't load, the unexpected popup, the 40-step task that dies on step 31. Everything we
   discussed — reliability, verification, self-correction, the self-authoring loop — *is* that gap.
   It's the hard 90%, not polish.

**A better target than AGI:**

> A product that reliably does a real, growing list of software tasks — unattended, affordably, and
> that fills its own gaps by writing tools.

Better because it's **measurable** (does it do task X 99/100?), **sellable** (users pay for "books my
meetings reliably," not "it's AGI"), **yours to build**, and it **grows toward** the AGI feeling on
its own. The companies winning in agents aren't claiming AGI — their agent **actually completes the
task every time.** Reliability is the moat, not intelligence, because everyone rents the same brains.

**Where you actually are:** you have the **breadth** (capabilities) and the **architecture**
(extensions, skills, sandbox). What's missing is the **depth**: reliability, self-checking, recovery,
and the write-its-own-tools loop. That depth is what makes "any task" true instead of "many tasks on
a good day." Not a letdown — a clear map. You're past the hardest architectural decisions and at the
start of the reliability work that wins.

---

## 7. Q: You said the AI supports this and that — but does it actually work, like a meeting recorder with my prompt?

**Verified answer (checked in code, not inferred from file names): No — "record my meeting and
summarize it" does not work from a prompt today.**

| Step | Status | Reality |
|---|---|---|
| Capture the meeting's audio | ❌ Missing | Nothing records system/loopback audio. The desktop tool only does screenshots + keyboard + UIA tree — no audio. |
| Transcribe audio | ⚠️ Partial | Works, but only on a file you **attach** — the `src/media-understanding/` pipeline auto-transcribes attached audio/video. Not a tool the agent can call from a prompt. |
| Summarize | ✅ Works | Once text exists, the LLM summarizes fine. |
| Do it all from a prompt | ❌ No path | No record tool, and transcription isn't prompt-callable — the agent has no way to "go record and transcribe" on command. |

Confirmed directly: the tool catalog has **no** transcribe/audio/record tool (only `skill_recorder`,
which saves *tasks* as skills — unrelated to audio). `transcribe-audio.ts` is an internal pipeline
function, not an agent tool.

**What does work right now:** if you already have a recording (mp3/mp4) and attach it → it
transcribes automatically, and you can then ask for a summary. The "record" half is missing.

**Self-correction:** earlier I said the meeting recorder was "mostly assembly — only a small
audio-capture tool needed." That was too optimistic and partly wrong:
1. Even transcription isn't prompt-callable today — it needs a tool wrapper to be invokable on demand.
2. Capturing live system audio on Windows (WASAPI loopback) is genuinely non-trivial, not "a small plugin."

**The honest general lesson:** when I said "you already have X," I was reading that the
**infrastructure exists in the repo** — not that it **works end-to-end from a prompt.** Those are
different, and I conflated them. The same caveat applies to other claims (e.g. there *is* a
`skill-recorder-tool.ts`, but "the agent creates skills" wasn't verified end-to-end either).

**Two honest options offered:** (1) verify the "attach a recording → transcribe → summarize" path
actually runs today, or (2) build the missing audio-capture tool wired as an agent tool so
"record my meeting and summarize" works from a prompt (real work, not assembly).

---

## Through-line of the whole conversation

The same idea kept resurfacing under different questions:

- **"Do any task"** is a reliability claim, not a capability claim.
- **Reliability and cost** are two separate dials — keep the smart model, cut cost via caching +
  fewer calls + smaller snapshots.
- **Self-written code/skills** is the highest form of both reliability and cost efficiency, and it's
  what makes "any task" honest.
- **"AGI"** is the wrong target; **"reliably completes a growing list of real tasks"** is the winnable,
  sellable, ownable one.
- **"Exists in the repo" ≠ "works from a prompt."** Infrastructure being present (plugins, pipelines,
  sandbox) is not the same as a verified end-to-end flow. Verify before claiming.

**Next concrete steps to choose from:** (a) turn on caching, (b) build the code-execution-in-sandbox
tool, (c) build the verification loop, (d) verify or build the meeting-recorder path. Picking real
tasks and grinding them to 99% reliability is how "almost there" becomes "actually there."
