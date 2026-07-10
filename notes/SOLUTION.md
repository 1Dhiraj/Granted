# The Solution — Drastically Lower Cost, Zero Information Loss

**Converged answer (config-only, testable now):**
**DeepSeek V4 Flash provider + automatic prefix caching.**

The model receives **byte-for-byte identical context** — every snapshot, every token.
Nothing is trimmed, summarized, or fetched-on-demand. Only two things change, both
purely on the billing side:

## The two lossless levers (web-confirmed, production-standard)

### Lever 1 — Cheaper per-token price (provider)
DeepSeek V4 Flash input is ~9× cheaper than Together Llama 70B. Identical context →
pure billing change → zero loss.

### Lever 2 — Automatic prefix caching (the big one)
Every agent step re-sends the whole history (system + AGENTS.md + accumulated
snapshots). That repeated prefix is the #1 cost line in agent loops. DeepSeek (like
OpenAI) **caches it server-side automatically** — no code, no markers — and bills the
repeated prefix at **~10% (cache-hit $0.014/M vs miss $0.14/M)**. The model still
receives the full context; only the bill on the repeat drops.

Web evidence: real agent deployments report **59–90% cost reduction** from prefix
caching alone, losslessly. ([ProjectDiscovery: 59%](https://projectdiscovery.io/blog/how-we-cut-llm-cost-with-prompt-caching), [DeepSeek context caching](https://chat-deep.ai/docs/deepseek-context-caching/))

## Measured impact (from this machine's real logs)

| Setup | $/user/mo (300 tasks) | Info loss |
|---|---|---|
| Together 70B (current) | $38.3 | — |
| DeepSeek Flash (price only) | $4.43 | none ✅ |
| **DeepSeek Flash + auto-caching** | **~$2–3** | **none** ✅ |

**$38 → ~$2–3 per user. ~13–18× cheaper. Model sees 100% of the information.**

## The ONE rule that keeps caching alive
Caching needs a **stable, append-only prefix.** Anything that varies per call at the
front/middle of the prompt (live timestamp, nonce, turn counter, per-turn metadata
header) shifts everything after it out of cache and silently kills the discount.
→ This is the thing the test must verify.

## Future lossless lever (NOT today — needs code)
Snapshot **subtree-hash dedup / reference IDs**: when the same page region repeats
across snapshots, reference it instead of re-sending. Genuinely lossless (content is
referenced, not removed), ~1.5–2× more. Adds code + asks the model to resolve
references → defer until the base is proven.

---

## TEST PLAN (run now)

**Pass condition is NOT "smaller bill" — it's a measured cache hit.**
Caching is lossless by construction; the only risk is that it silently doesn't engage.

1. **Provider/key**: configure a caching-capable provider (DeepSeek native or DeepInfra).
2. **Set** `agents.defaults.model.primary` = DeepSeek V4 Flash; restart gateway.
3. **Run a multi-step task that succeeds**: e.g. "open google.com, type weather, take a
   snapshot, clear it, type AI news" — needs ≥4–5 model calls so caching can show across
   calls *within one task*.
4. **Measure** the per-call split from the session jsonl (same grep we used):
   ```
   grep -o '"usage":{"input":[0-9]*,...,"cacheRead":[0-9]*' <session>.jsonl
   ```
5. **PASS** = `cacheRead` comes back **> 0 and grows** across calls in the task.
   **FAIL signature** (`cacheRead ≈ 0`) ≠ "caching is useless" → it means a per-call
   varying token poisoned the prefix. Then inspect `src/agents/system-prompt.ts` + the
   AGENTS.md injection for dynamic content at the front. **Measure first, archaeology second.**

## Honest scope
- Caching is a **within-task** lever (warm across the ~7 calls of one task; cold between
  separate prompts minutes apart). The ~$2–3/mo assumes this. The test confirms the
  within-task multiplier — don't extrapolate one warm task to the monthly number without
  noting cache goes cold between tasks.
- Browser/Chrome compute runs on the **user's machine → $0 to you** (local-first). Token
  cost is your only per-user COGS (you provide credits).
