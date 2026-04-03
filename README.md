# Fast Browser

Fast Browser is an open-source Chrome extension for natural-language browser automation.

This repo is intentionally starting small. The current scaffold now proves the core extension plumbing and the first real agent loop:

- Manifest V3 extension with a side panel
- background service worker
- content script
- DOM-native page extraction
- React side panel for task entry and provider settings
- first observe → plan → act → verify loop against the active tab

## Current scope

This is not a full browser agent yet. The current implementation is focused on the first trustworthy slice:

The working loop today is:

1. Open the side panel
2. Configure a provider (`Ollama`, `OpenAI-compatible`, or `Anthropic`)
3. Enter a task
4. Run the loop on the active tab
5. Observe a structured page snapshot
6. Ask the model for exactly one JSON action
7. Execute a small safe action set
8. Re-observe and continue until done, blocked, or out of steps

Supported action types in this slice:

- `click`
- `type`
- `scroll`
- `wait`
- `navigate`
- `done`
- `ask_human`

The content script treats refs as snapshot-local. After every action, the page is re-extracted and old refs expire immediately.

## Multi-provider support

Yes, multi-provider support includes Ollama in this first action-loop slice.

Current provider shape:

- Anthropic
- OpenAI-compatible APIs
- Ollama

The current implementation wires live calls for all three paths. The default local-friendly setup is Ollama using the OpenAI-compatible chat completions endpoint.

What is still intentionally missing:

- streaming run updates over a `Port`
- richer action types like `select`, `extract`, or multi-action plans
- robust page-settling logic for highly dynamic apps
- file upload, iframe, and rich-editor flows
- production-grade prompt-injection hardening

## Development

```bash
npm install
npm run dev
```

Then load the built extension in Chrome from `dist/`.

## Build

```bash
npm run build
```

## Test

```bash
npm test
```

## Roadmap

Near-term priorities:

- stream step-by-step run updates to the side panel
- add a small action verifier and better page-settling logic
- support richer but still safe actions like `select` and `extract`
- harden prompt-injection defenses before broader release
