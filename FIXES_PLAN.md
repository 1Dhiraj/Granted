# Browser Agent — Plan (research-informed)

Based on how the production agents actually work (Comet = DOM-based; Atlas =
vision/computer-use; Antigravity = hybrid + a dedicated computer-use subagent) and the
refs-vs-coordinates research.

## Core conclusions (what the research settled)

1. **Ref-based actions are the RIGHT foundation.** a11y snapshot → refs (@e1) → "click @e1"
   is faster, cheaper, more precise, handles below-the-fold, ~78% success on accessible
   pages. Coordinate-clicking (Atlas-style) is fragile. **Keep OpenClaw's ref approach.**
2. **Best practice is HYBRID:** refs PRIMARY + vision (screenshot) SECONDARY signal.
   (Antigravity does this.) Vision is an add-on layer, not a replacement.
3. **Highest leverage = a COMPUTER-USE model** (Gemini 2.5 Computer Use). Antigravity runs
   a dedicated browser subagent on exactly this model class. It's purpose-built to emit
   reliable browser tool calls AND handle complex widgets — fixing both our blockers
   (Maverick's text-emit + DeepSeek's form-perception stall). **We already have it:
   `gemini-2.5-computer-use-preview-10-2025` is on the Gemini key.**

## Diagnosis recap (what we ruled out, with evidence)
- ❌ Not "model not smart enough" (Maverick & DeepSeek both capable)
- ❌ Not rate limit on the form (NVIDIA, 0 errors)
- ❌ Not vision-needed alone (forced vision on, form still failed)
- ❌ Not the overloaded-tool shape (same tool → both real calls AND text-emit)
- ✅ Real blockers: (a) tool-call CHANNEL reliability (model emits call as text), and
  (b) form-widget perception. A computer-use model targets both.

---

## THE PLAN

### Phase 0 — Clean baseline (housekeeping, ~5 min)
- [ ] Rebuild to drop the forced-vision change (source already reverted)
- [ ] Confirm a known-good default (Playwright `openclaw` backend; DeepSeek V4 Pro for
      reliable common-task tool-calling)

### Phase 1 — Try the Computer Use model (highest leverage; the Antigravity pattern)
- [ ] Wire `gemini-2.5-computer-use-preview-10-2025` into config (multimodal)
- [ ] Test on: the Google Form (the task that stalled everything else) + a couple common tasks
- [ ] PASS = it fills the form fields (does what Antigravity's stack does)
- ⚠️ Caveat: Gemini free tier ~5 RPM throttle — testing may be slow; production computer-use
      likely needs paid Gemini. Measure calls/task to size it.

### Phase 2 — Hybrid perception (the field's best-practice architecture)
- [ ] Gate the labeled-screenshot (set-of-marks) as a SECONDARY signal for multimodal models
      only — refs stay primary. (NOT vision-only; NOT global.)
- [ ] Verify it doesn't break text-only routes (DeepSeek/coding)

### Phase 3 — Transport robustness (helps ALL general models)
- [ ] Add "extract tool call from content text" fallback in the openai-completions transport,
      so models that mis-channel (Maverick's `{"name":"browser",...}` in text) still work
- [ ] Test Maverick on the form again after this

### Phase 4 — Production hardening (after reliability)
- [ ] Model routing by purpose: computer-use model → browser; cheap model → chat; etc.
- [ ] Per-user / per-period spend metering (replace global spendLimitUsd)
- [ ] Cost: caching + snapshot reduction (lossless levers from COST_REDUCTION_ARCHITECTURE.md)

---

## Recommended order & rationale
1. **Phase 0** (clean state) → 2. **Phase 1 (Computer Use model)** — by far the highest
   leverage; it's the proven production pattern and we already have the model.
3. Phase 3 (transport fallback) makes general models robust as a bonus.
4. Phase 2 (hybrid vision) + Phase 4 (production) once reliability holds.

**The big bet:** stop trying to make a *general* model behave like a browser agent — use
the *computer-use model class* built for it (what Antigravity ships). Phase 1 tests that
directly, on a model you already have.
