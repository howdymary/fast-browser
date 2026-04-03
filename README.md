# Fast Browser

Fast Browser is an open-source Chrome extension for natural-language browser automation.

This repo is intentionally starting small. The current scaffold now proves the core extension plumbing and the first real agent loop:

- Manifest V3 extension with a side panel
- background service worker
- content script
- DOM-native page extraction
- React side panel for task entry and provider settings
- first observe → plan → act → verify loop against the active tab
- live step-by-step updates streamed to the side panel over a dedicated per-run extension Port

## Architecture

Fast Browser is a three-part extension:

- `background service worker`: owns orchestration, provider calls, action execution, cancellation, and run state
- `content script`: snapshots the active page, resolves refs, and performs DOM-native page interactions
- `side panel`: collects the task, provider settings, and live phase updates

The current DAG is a single-run observe → plan → act → verify loop. Each run gets its own Port session, and the UI derives from streamed phase events instead of polling.

## Message Flow

1. The user enters a task in the side panel.
2. The side panel sends the request to the background worker.
3. The background worker snapshots the active tab through the content script.
4. The worker sends the snapshot to the configured model and asks for exactly one JSON action.
5. The worker validates the action, executes a safe browser operation, and streams the result back to the panel.
6. The content script re-extracts the page so stale refs expire immediately.
7. The loop repeats until the task is done, blocked, cancelled, or the step budget is exhausted.

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

Each run now uses its own Port session, server events carry monotonically increasing `seq` numbers, and the side panel derives its UI state directly from the streamed phase events. Runs can also be cancelled explicitly, with cancellation threaded through the active model call and browser actions.

## Security Model

- The extension uses a Manifest V3 service worker and a strict extension-page CSP.
- User tasks and model outputs are treated as untrusted input.
- Provider API keys are kept in session storage, while non-secret model settings persist locally.
- Page refs are snapshot-local and expire after every re-extraction.
- The action surface is intentionally small so the worker can reject anything outside the safe set.
- Sensitive fields are detected in the content script and type actions against them are blocked.
- Cross-origin navigation requires explicit human approval before the worker will proceed.
- Prompt injection defenses are still a work in progress, so the current build is not suitable for high-risk autonomous browsing without more hardening.

## Multi-provider support

Yes, multi-provider support includes Ollama in this first action-loop slice.

Current provider shape:

- Anthropic
- OpenAI-compatible APIs
- Ollama

The current implementation wires live calls for all three paths. The default local-friendly setup is Ollama using the OpenAI-compatible chat completions endpoint.

What is still intentionally missing:

- richer action types like `select`, `extract`, or multi-action plans
- robust page-settling logic for highly dynamic apps
- file upload, iframe, and rich-editor flows
- production-grade prompt-injection hardening
- persistent long-term memory across runs

## Known Limitations

- `<all_urls>` host permissions are still used in the scaffold, so the extension is broader than a production deployment should be.
- The DOM extractor currently ignores iframes and shadow DOM.
- Page snapshots are intentionally capped at 60 interactive elements and 2500 visible-text characters.
- The current action set is intentionally narrow and does not yet cover form controls beyond typing into the active target.
- The prompt format expects one JSON action per step, so multi-step plans are not yet supported.
- The current security model reduces risk, but it does not fully solve prompt injection or malicious page content.

## Production Host Permissions

For production, narrow the host permissions in `manifest.config.ts` before shipping.

- Prefer domain-scoped permissions instead of `<all_urls>`
- Keep `activeTab` for user-initiated access where possible
- Only add explicit host permissions for domains your extension must automate
- Use `chrome.permissions.request()` for optional runtime elevation instead of bundling broad access by default
- Rebuild and retest after any permission change

The current manifest already includes a CSP for extension pages:

```ts
content_security_policy: {
  extension_pages: "script-src 'self'; object-src 'none';",
},
```

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

- add a small action verifier and better page-settling logic
- support richer but still safe actions like `select` and `extract`
- harden prompt-injection defenses before broader release
- tighten host permissions for production deployment
