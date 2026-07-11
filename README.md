# Granted

**Your AI that actually does things — by voice, from any chat app, on your real computer.**

Granted is a personal AI agent you talk to like a person ("Jarvis"-style) and that executes like an operator: it runs shell commands, controls your desktop, browses the web, generates media, schedules its own jobs, and reports back — on Telegram, WhatsApp, Discord, the web UI, or full-duplex voice.

Granted is a fork of [OpenClaw](https://github.com/openclaw/openclaw) focused on three things upstream treats as secondary:

- **Voice-first.** Wake word, talk mode, and a full-duplex realtime voice path (Gemini Live), plus local TTS via Piper and Kokoro — a real hands-free assistant, not push-to-talk.
- **Reliable tool-calling on any model.** Fixed streaming and tool-call handling for local models (Ollama, Qwen), a task-router that sends each job to the model best suited for it, and a rate-limit failover policy you control.
- **Cost you can see.** Per-session cost tracking, prompt-cache savings accounting, and a cost-reduction architecture so an always-on agent doesn't burn a hole in your wallet.

## What it can do

Ask it, in plain language, over any connected channel:

- "Clone this repo, run the tests, and tell me if they pass."
- "Open Notepad, type hello world, save it to my desktop." (desktop control)
- "Every day at 8am, check Hacker News and message me the top story." (cron + cross-channel delivery)
- "Make me a logo for a coffee brand." (image/video/audio generation)
- Send a voice note: "Do what I said." (transcribe → execute)

The full task list we test against is in [qa/capability-suite.md](qa/capability-suite.md) — a 40+ task "Can it do anything?" scorecard. Failures on that suite are the roadmap.

## Quick start

Requirements: Node 22+, pnpm.

```bash
git clone https://github.com/1Dhiraj/Granted.git
cd Granted
pnpm install
pnpm build
node openclaw.mjs setup      # interactive: model provider, channels, security
node openclaw.mjs gateway    # start the agent gateway
```

Then open the web UI, or pair a channel (Telegram, WhatsApp, Discord, …) during setup and just message it.

The CLI binary is `granted`. Existing OpenClaw configs and state dirs (`.openclaw`) are picked up automatically — the rename is backward compatible.

## Architecture (short version)

- **Gateway** — long-running daemon that owns channels, sessions, cron jobs, and the agent runtime.
- **Channels** — Telegram, WhatsApp, Discord, Slack, Signal, iMessage, and ~40 more via extensions.
- **Agents** — embedded runner with tool use (shell, browser, files, desktop control, media), failover across model profiles, and subagent spawning.
- **Extensions** — model providers (Anthropic, OpenAI, Google, Ollama, and ~50 more), TTS/STT, browser automation, phone control, task routing.

Developer docs live in [docs/](docs/). Vision and roadmap: [VISION.md](VISION.md).

## Security

Granted executes real commands on real machines. Defaults are conservative: owner allowlists, pairing for unknown senders, scoped tool permissions. Read [SECURITY.md](SECURITY.md) before exposing it to a group chat or the internet.

## Relationship to OpenClaw

Granted tracks upstream OpenClaw (forked at v2026.4.7) and carries its own delta (~20k lines): voice stack, desktop control tools, task router, local-TTS providers, tool-calling fixes for local models, cost accounting, agent jobs UI, and the capability suite. Upstream is vendored as the `upstream` git remote for periodic syncs.

## License

See [LICENSE](LICENSE). Upstream code © the OpenClaw contributors.
