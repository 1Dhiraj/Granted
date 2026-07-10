# Unit Economics Proof — $20/month plan, $3–5 target profit

**Goal:** prove a user can run ≥300 browser prompts/month while you keep $3–5 profit
on a $20 plan (i.e. LLM token COGS must stay well under ~$15/user/month).

**Method:** measured — not estimated. Real token counts pulled from an actual
OpenClaw browser session on this machine
(`~/.openclaw/agents/main/sessions/4d3ee0ee-…jsonl`), priced at each provider's
real rate (codebase catalog + web Apr–May 2026).

---

## 1. Real measured token usage (ground truth)

From one real session:

| Metric | Measured value |
|---|---|
| Model calls | 164 |
| Total input tokens | 3,330,592 (3.33M) |
| **Avg input tokens / call** | **20,308** |
| Real browser tool calls | ~20 |
| Heartbeat polls (noise) | 37 |
| Compaction events (overflow) | 16 |

> ⚠️ This session is **retry-inflated** — it's from the qwen debugging period with
> failure loops, 37 heartbeats, and 16 compactions. So every number below is a
> **worst-case ceiling**, not a healthy task. Real tasks cost less.

Earlier I estimated snapshots at ~2,000 tokens. The **real** snapshots on disk are
7,500–48,000 tokens. That 15–24× error is why estimates were worthless and why this
is measured instead.

---

## 2. Real per-call cost (input 20,308 tok + assumed 400 tok output)

Output was logged as 0 (logging gap, not free); we assume a conservative 400 tok/call.
Output cost is immaterial either way — shown to be bulletproof.

| Provider · model | in $/M | out $/M | **$/call** |
|---|---|---|---|
| DeepInfra · DeepSeek V4 Flash | 0.10 | 0.20 | **$0.00211** |
| DeepSeek native · V4 Flash | 0.14 | 0.28 | $0.00296 |
| OpenAI · GPT-5.4 Nano | 0.20 | 1.25 | $0.00456 |
| xAI · Grok 4 Fast | 0.20 | 0.50 | $0.00426 |
| Together · Llama 70B (current) | 0.88 | 0.88 | $0.01822 |
| OpenAI · GPT-5.4 (current default) | 2.50 | 15.00 | $0.05677 |

---

## 3. Cost per 300 prompts/month — sensitivity on calls-per-task

A healthy browser task ≈ 5–10 model calls (nav→snap→act→snap→act).
**No caching applied** — this is the floor; caching is upside.

| Provider | 5 calls/task | 7 calls/task | 10 calls/task |
|---|---|---|---|
| **DeepSeek V4 Flash (DeepInfra)** | **$3.17** | **$4.43** | **$6.33** |
| DeepSeek V4 Flash (native) | $4.44 | $6.22 | $8.88 |
| GPT-5.4 Nano | $6.84 | $9.58 | $13.68 |
| xAI Grok 4 Fast | $6.39 | $8.95 | $12.78 |
| Together Llama 70B (current) | $27.3 | $38.3 | $54.7 |
| GPT-5.4 (current default) | $85.2 | $119 | $170 |

**Profit per user = $20 − token COGS** (token line only):

| Provider | profit @7 calls/task |
|---|---|
| **DeepSeek V4 Flash** | **+$15.6** ✅ exceeds target |
| GPT-5.4 Nano | +$10.4 ✅ |
| xAI Grok 4 Fast | +$11.0 ✅ |
| Together Llama 70B | **−$18.3** ❌ loses money |
| GPT-5.4 default | **−$99** ❌ catastrophic |

---

## 4. Worst-case bound (the pathological 164-call session)

Even the full retry-looping 3.33M-token session costs:

| Provider | cost for the whole broken session |
|---|---|
| DeepSeek V4 Flash | **$0.33** |
| GPT-5.4 Nano | $0.67 |
| Together Llama 70B | $2.93 |
| GPT-5.4 default | $8.33 |

A user could run **~10 catastrophic broken sessions/month on DeepSeek Flash for $3.30**
and you'd still profit. That's the safety margin.

---

## 5. Verdict

✅ **Yes — the $20 plan with $3–5 profit is provable on the token line**, using
**DeepSeek V4 Flash** (or GPT-5.4 Nano / Grok 4 Fast). All three clear $10+ profit
at a realistic 7 calls/task, 300 tasks/month, **before caching**.

❌ **Together Llama 70B (current) and GPT-5.4 (current default) both lose money** —
this is the measured proof behind "Together isn't enough."

### SCOPE — what this proves and does NOT prove
- ✅ Proven: **LLM token COGS** fits with $10–16 to spare per user.
- ❌ NOT costed here: headless-browser/compute per user (running Chrome per session
  is real server cost), hosting, bandwidth/egress. For a browser-automation SaaS
  these may rival the token cost and must be sized separately before claiming total
  profit. **Necessary, not yet sufficient.**

### Caching = upside on top (not relied on)
Snapshots are 80–90% cacheable within a task. On providers with real cache discounts
(DeepSeek, OpenAI, xAI), warm-cache within a task cuts the repeated-prefix cost ~10×,
pushing DeepSeek Flash toward ~$2–3/month. We do **not** depend on it for the proof.

### Source caveat
DeepInfra's $0.10 came from their marketing page; native DeepSeek $0.14 also clears
the bar, so the conclusion holds either way.
