# Granted Vision

Granted is the AI that actually does things — and you talk to it.

One sentence: **a voice-first personal operator that can complete real tasks on your real devices, reachable from any chat app, reliable enough to trust and cheap enough to leave running.**

Granted is a fork of [OpenClaw](https://github.com/openclaw/openclaw). Upstream gives us the agent runtime, channels, and provider ecosystem; Granted's own bet is the layer upstream treats as secondary:

## The bet

1. **Voice is the interface.** Wake word → full-duplex conversation (Gemini Live) → the agent acts while you keep talking. Local TTS (Piper, Kokoro) when privacy or cost matters. The end state is Jarvis, not a chatbot with a microphone button.
2. **Capability is measured, not claimed.** The [capability suite](qa/capability-suite.md) is the product spec: 40+ real-user tasks across shell, files, web, desktop control, media, scheduling, memory, and safety. The score is the KPI; the failures are the roadmap. Nothing ships as "supported" until it passes.
3. **Any model, routed intelligently.** The task-router sends each job to the model that handles it best — frontier models for hard reasoning, local/cheap models for routine steps. Tool-calling works on local models (Ollama, Qwen), not just the big APIs.
4. **Always-on must be affordable.** Session cost tracking, prompt-cache savings accounting, and cost-reduction architecture are first-class features, because a personal agent you turn off to save money is not a personal agent.

## Current priorities

1. Run the capability suite, publish the baseline score, and fix failures in order of user pain.
2. First-run experience: a stranger installs and reaches a working voice conversation in under 10 minutes.
3. Reliability of the top-20 tasks (the ones a daily user actually repeats) to near-100%.
4. Periodic upstream syncs (forked at v2026.4.7; upstream is vendored as the `upstream` remote) to inherit security fixes without growing our delta.

## What Granted is not

- Not a chatbot. If a release doesn't increase the number of tasks it can *complete*, it's not progress.
- Not a model company. We route to the best available models; we don't train them.
- Not "open a PR upstream" territory for our differentiators (voice stack, router, cost layer) — but bug fixes that apply upstream should be offered upstream.

## Security

Granted executes real commands on real machines. Secure defaults, owner allowlists, explicit knobs for high-power workflows. Canonical policy: [SECURITY.md](SECURITY.md). Section J of the capability suite (safety gates) must pass before any capability score counts.
