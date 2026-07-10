# Cost Reduction — Architecture, Techniques & Proof

A complete reference for how to drastically reduce LLM cost in the OpenClaw browser
agent **without information loss**. Provider-independent first (architecture), then the
measured proof and the plan.

---

## 1. The one equation that explains everything

```
Task cost  ≈   N_calls   ×   tokens_per_call   ×   price_per_token
              (how many       (how big each        (provider rate)
               times you       request is)
               hit the model)
```

Every cost-reduction technique attacks one of these three numbers. The first two are
**architecture** (independent of provider); the third is provider + caching.

---

## 2. Why agent loops are expensive: REDUNDANCY

One browser task is NOT one model call — it's a **loop**. Each call re-sends everything
from the previous call plus a little new:

```
User: "open google, type weather"
  ├─ Call 1:  [system + AGENTS.md + tools] + [navigate]                 →  ~9,500 tokens
  ├─ Call 2:  [system + AGENTS.md + tools] + [navigate + snapshot]      → ~14,600 tokens
  ├─ Call 3:  [system + AGENTS.md + tools] + [nav + snap + action]      → ~17,500 tokens
  ├─ Call 4:  [...all of the above... + new snapshot]                   → ~18,300 tokens
  └─ ...
```

The `[system + AGENTS.md + tools]` block and every past snapshot get **re-sent and
re-billed on every call**. Measured average: **20,308 tokens/call**, ~80% identical to
the previous call.

> **The cost of an agent is the cost of re-sending the same context over and over.**
> Cost reduction = eliminating redundant token processing.

---

## 3. The architecture: 3 places to attack

```
        ┌─────────────────────────────────────────────┐
        │  STATIC PREFIX                               │  ← re-sent EVERY call
        │  system prompt + tool defs + AGENTS.md       │     (~2,500 tokens × every call)
        ├─────────────────────────────────────────────┤
        │  HISTORY (grows every step)                  │  ← re-sent EVERY call, gets bigger
        │  snapshot₁ + action₁ + snapshot₂ + action₂…  │     (snapshots = 7,500–48,000 each!)
        ├─────────────────────────────────────────────┤
        │  NEW OBSERVATION (this step's snapshot)      │  ← the only truly NEW tokens
        └─────────────────────────────────────────────┘
                    × N loop iterations
```

---

## 4. The three levers (with info-loss flags)

### Lever 1 — Shrink `tokens_per_call` (size of each request)
Dominant payload = **snapshots** (7,500–48,000 tokens each, piling up in HISTORY).

| Technique | What it does | Info loss |
|---|---|---|
| **Compact snapshot** | strip empty layout nodes, keep all text + elements | **none** (whitespace only) ✅ |
| **Subtree dedup / hashing** | unchanged page regions referenced, not re-sent | **none** (referenced) ✅ |
| **Trim static prefix** | cut redundant AGENTS.md / tool bloat | **none** if redundant ✅ |
| **Interactive-only** | send only buttons/links/inputs, fetch text on demand | conditional ⚠️ |
| **Relevance filter** | only elements related to the task | yes ❌ |

### Lever 2 — Cut `N_calls` (how many times you loop)

| Technique | What it does | Info loss |
|---|---|---|
| **Reliability** | a model that doesn't loop/retry → 7 calls not 164 | **none** ✅ |
| **Action batching** | several actions per call instead of one-per-call | **none** ✅ |
| **Snapshot discipline** | only snapshot when the page actually changed | **none** ✅ |
| **Kill background polls** | don't run heartbeats mid-task | **none** ✅ |

> Measured: 164 calls, but only ~20 were real work — the rest was looping + 16
> compactions + 37 heartbeats. Cutting N from 164→7 is a ~20× win, **zero info loss**
> (deleting failures, not information).

### Lever 3 — Make the redundant part cheaper = caching
Doesn't shrink anything; bills the repeated ~80% at ~10%. **Lossless.** See §6.

---

## 5. Measured ground truth (from this machine's real logs)

Real session: `~/.openclaw/agents/main/sessions/4d3ee0ee-…jsonl`

| Metric | Value |
|---|---|
| Model calls | 164 |
| Total input tokens | 3,330,592 (3.33M) |
| **Avg input tokens / call** | **20,308** |
| Real browser tool calls | ~20 |
| Heartbeat polls (waste) | 37 |
| Compaction events (overflow waste) | 16 |
| Real snapshot sizes on disk | 7,500 – 48,000 tokens each |
| AGENTS.md (injected every call) | 2,506 tokens |

> ⚠️ This session was **retry-inflated** (qwen looping). It's a worst-case ceiling, so
> every cost number derived from it is conservative.

---

## 6. How caching saves money (worked example, real calls)

Each call re-sends everything from the call before + new. The "same as last time" part is
a **cache hit** (~10% price); only the new part pays full.

| Call | Input tokens | Same as last → cached @10% | New → full price |
|---|---|---|---|
| 1 | 14,631 | 0 (cold) | 14,631 |
| 2 | 17,500 | 14,631 | 2,869 |
| 3 | 18,282 | 17,500 | 782 |
| 4 | 18,493 | 18,282 | 211 |
| 5 | 18,730 | 18,493 | 237 |
| 6 | 18,845 | 18,730 | 115 |
| **Total** | **106,481** | **87,636 (82%) cached** | **18,845 (18%) new** |

At example rates (miss $0.14/M, hit $0.014/M):
- **Without cache:** 106,481 × $0.14/M = **$0.0149**
- **With cache:** (87,636 × $0.014) + (18,845 × $0.14) = **$0.0039**
- **→ 74% cheaper, on ONE task, from ONE prompt the user typed once.**

**Key facts about caching:**
- It's ~90% off the repeated part, **not free**. New tokens always cost full.
- It matches on **identical prefix**, not "same action."
- It's **within-task** (warm across the 7 calls of one task; cold between separate
  prompts minutes apart).
- Requires a **stable, append-only prefix** — any per-call-varying token (timestamp,
  nonce, per-turn metadata header) at the front silently kills it.
- The user never repeats a prompt — the **agent's own loop** creates the repetition.

---

## 7. Provider cost reference ($ per 1M tokens)

Real values from the codebase catalog + web (May 2026). Caching only helps where
`cache read < input`.

| Provider · Model | Input | Output | Cache read | Real cache discount? |
|---|---|---|---|---|
| DeepSeek V4 Flash (native) | 0.14 | 0.28 | 0.014 | ✅ 90% |
| DeepSeek V4 Flash (DeepInfra, US) | 0.10 | 0.20 | 0.02 | ✅ 80% |
| OpenAI GPT-5.4 Nano | 0.20 | 1.25 | 0.02 | ✅ 90% |
| xAI Grok 4 Fast | 0.20 | 0.50 | 0.05 | ✅ 75% |
| Anthropic Haiku 4.5 | 1.00 | 5.00 | 0.10 | ✅ 90% |
| **Together Llama 70B (current)** | **0.88** | **0.88** | **0.88** | ❌ none |
| **OpenAI GPT-5.4 (current default)** | **2.50** | **15.00** | **0.25** | ✅ but expensive |

> Together is the worst realistic option: expensive input **and** no cache discount
> (the repeated 82% of every task still costs full price).

---

## 8. Unit economics proof ($20 plan, target $3–5 profit)

Budget: COGS must stay under ~$15/user/mo. Measured cost per 300 tasks/month
(7 model calls/task), **no caching** (the floor):

| Provider | $/user/mo | Profit on $20 |
|---|---|---|
| **DeepSeek V4 Flash** | $4.43 | **+$15.6** ✅ |
| xAI Grok 4 Fast | $8.95 | +$11.0 ✅ |
| GPT-5.4 Nano | $9.58 | +$10.4 ✅ |
| Together Llama 70B (now) | $38.3 | −$18.3 ❌ |
| GPT-5.4 default (now) | $119 | −$99 ❌ |

**Lossless stack, cumulative (no info loss at any step):**

| Step | $/user/mo |
|---|---|
| Together (now) | $38.3 |
| → cheaper provider | $4.43 |
| → + reliable model (fewer wasted calls) | ~$3.5 |
| → + compact snapshots | ~$2.8 |
| → + hygiene (trim AGENTS.md, snapshot discipline, fewer heartbeats) | ~$2.5 |
| → + caching (bonus, within-task) | ~$1.5 |

### Scope note
This is the **LLM token line only**. Browser/Chrome compute runs on the **user's
machine → $0 to you** (OpenClaw is local-first). Token cost is your only per-user COGS
(assuming you provide the API credits).

---

## 9. The plan

- **Step 0 (gate):** obtain a caching-capable API key (DeepSeek recommended).
- **Phase 1 (config-only):** switch provider, set `spendLimitUsd` safety ceiling,
  restart, run a real multi-step browser task, measure from the session log:
  reliability + real cost + cacheRead split (PASS = cacheRead > 0 and growing).
- **Phase 2 (lossless hygiene):** `compact:true` snapshots, trim AGENTS.md, tune
  heartbeat/loop-detection. Re-measure.
- **Phase 3 (optional, later):** interactive-only snapshots + `readContent`, escalate-up
  model routing — only if more savings needed (Phases 1–2 already hit target).

---

## 10. One-line summary

An agent is expensive because it **re-sends the same context every loop iteration**.
Reduce cost three ways — **re-send fewer times** (reliability, batching), **re-send less**
(compact/dedup snapshots), **re-send cheaper** (caching). The **snapshot is the biggest
token**, so "how we represent the page to the model" is the central architectural
question — not which provider. Levers 1 & 2 are both achievable losslessly.
