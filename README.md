# Fast Browser

Fast Browser is an open-source Chrome extension for natural-language browser automation.

This repo is intentionally starting small. The current scaffold proves the core extension plumbing:

- Manifest V3 extension with a side panel
- background service worker
- content script
- DOM-native page extraction
- React side panel that can inspect the active tab and render a structured page snapshot

## Current scope

This is not a full browser agent yet. The first implementation is focused on the most important primitive: a reliable DOM extractor and clean message flow between the side panel, service worker, and content script.

The first working loop is:

1. Open the side panel
2. Click `Inspect page`
3. Capture a structured snapshot of the active page
4. Render the top interactive elements and visible text preview

## Multi-provider support

Yes, multi-provider support can include Ollama.

The planned provider shape is:

- Anthropic
- OpenAI-compatible APIs
- Ollama

The repo already includes a provider settings type and a placeholder LLM client, but live LLM calls are intentionally not wired into this first scaffold yet. The current priority is correctness of extraction and extension architecture.

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

## Docs

- [Product spec](./fast-browser-product-spec.md)
- [Engineering prompt](./fast-browser-engineering-prompt.md)
