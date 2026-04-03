# Fast Browser — Engineering Implementation Prompt

> **Hand this file to your coding agent (Claude Code, Cursor, Codex, etc.) along with the product spec (fast-browser-product-spec.md). Say: "Read both files, then build Phase 1 of Fast Browser step by step."**

---

## What You're Building

Fast Browser is an open-source Chrome extension (Manifest V3) that lets non-technical users automate their browser with natural language. It reads the DOM structure of web pages (not screenshots), sends a compact text representation to an LLM, and executes the LLM's chosen action directly in the page.

**Key differentiators from existing tools:**
- Chrome Extension (not CLI) — runs inside the user's browser, has their sessions/cookies
- Consumer-facing (not dev tool) — natural language input, not shell commands
- DOM-native (not screenshots) — 4x faster than vision-based agents
- Open source — MIT licensed, works with any LLM provider
- Privacy-first — optional fully local mode via Ollama

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Extension framework | Chrome Manifest V3 | Required for Chrome Web Store, modern extension standard |
| Build tool | Vite + CRXJS Vite Plugin | Hot-reload for Chrome extensions, best DX |
| Language | TypeScript (strict mode) | Type safety for complex cross-context messaging |
| Side panel UI | React 18 + Zustand | Lightweight state management, fast renders |
| Styling | Tailwind CSS | Utility-first, small bundle, consistent design |
| LLM communication | Fetch API (from service worker) | Direct API calls, no intermediary server |
| Testing | Vitest + Chrome Extension testing utils | Fast unit tests for extractors and action logic |

---

## Project Structure

Create this exact directory structure:

```
fast-browser/
├── manifest.json
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.ts
├── postcss.config.js
├── src/
│   ├── background/
│   │   ├── service-worker.ts          # Extension entry point, message router
│   │   ├── agent-loop.ts             # Core observe→plan→act→verify cycle
│   │   ├── llm-client.ts            # LLM provider abstraction (Claude, GPT, Gemini, Ollama)
│   │   └── llm-providers/
│   │       ├── anthropic.ts          # Claude API integration
│   │       ├── openai.ts             # OpenAI API integration
│   │       └── ollama.ts             # Local Ollama integration
│   ├── content/
│   │   ├── content-script.ts         # Entry point, message handler
│   │   ├── dom-extractor.ts          # THE CORE: compact DOM → text representation
│   │   ├── action-executor.ts        # Execute click/type/scroll/navigate actions
│   │   ├── element-highlighter.ts    # Visual feedback (highlight elements on action)
│   │   ├── page-monitor.ts           # Detect page settled after navigation/clicks
│   │   └── sensitive-detector.ts     # Detect password/payment fields, redact values
│   ├── sidepanel/
│   │   ├── index.html                # Side panel HTML shell
│   │   ├── main.tsx                  # React entry point
│   │   ├── App.tsx                   # Root component with routing
│   │   ├── components/
│   │   │   ├── ChatInput.tsx         # Natural language input field
│   │   │   ├── ActionFeed.tsx        # Scrollable feed of agent actions
│   │   │   ├── ActionCard.tsx        # Single action display (✓ Clicked "Search")
│   │   │   ├── ConfirmDialog.tsx     # Human approval prompt for sensitive actions
│   │   │   ├── StatusIndicator.tsx   # Current agent state (idle/thinking/acting/asking)
│   │   │   ├── SettingsView.tsx      # API key config, LLM provider selection
│   │   │   └── WelcomeView.tsx       # First-run onboarding
│   │   └── stores/
│   │       ├── agent-store.ts        # Agent state (current task, history, status)
│   │       └── settings-store.ts     # User preferences (API key, provider, theme)
│   ├── shared/
│   │   ├── types.ts                  # Shared TypeScript types
│   │   ├── messages.ts               # Chrome message protocol (type-safe)
│   │   └── constants.ts              # Action types, limits, defaults
│   └── assets/
│       └── icons/                    # Extension icons (16, 48, 128px)
├── public/
│   └── icons/
│       ├── icon-16.png
│       ├── icon-48.png
│       └── icon-128.png
└── tests/
    ├── dom-extractor.test.ts         # Unit tests for DOM extraction
    ├── action-executor.test.ts       # Unit tests for action execution
    └── sensitive-detector.test.ts    # Unit tests for sensitive field detection
```

---

## Implementation Order

Build in this exact order. Each step should be testable before moving to the next.

### STEP 1: Project Scaffold

Set up the project with Vite, CRXJS, TypeScript, React, and Tailwind.

```bash
npm create vite@latest fast-browser -- --template react-ts
cd fast-browser
npm install @crxjs/vite-plugin@latest
npm install zustand
npm install -D tailwindcss @tailwindcss/vite postcss
npm install -D @types/chrome
```

**manifest.json:**

```json
{
  "manifest_version": 3,
  "name": "Fast Browser",
  "version": "0.1.0",
  "description": "Open-source browser automation with natural language",
  "permissions": [
    "activeTab",
    "sidePanel",
    "storage",
    "tabs",
    "scripting"
  ],
  "host_permissions": [
    "<all_urls>"
  ],
  "background": {
    "service_worker": "src/background/service-worker.ts",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["src/content/content-script.ts"],
      "run_at": "document_idle"
    }
  ],
  "side_panel": {
    "default_path": "src/sidepanel/index.html"
  },
  "action": {
    "default_icon": {
      "16": "public/icons/icon-16.png",
      "48": "public/icons/icon-48.png",
      "128": "public/icons/icon-128.png"
    },
    "default_title": "Fast Browser"
  },
  "icons": {
    "16": "public/icons/icon-16.png",
    "48": "public/icons/icon-48.png",
    "128": "public/icons/icon-128.png"
  }
}
```

**vite.config.ts:**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import manifest from './manifest.json';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    crx({ manifest }),
  ],
});
```

**Verify:** Run `npm run dev`, load the unpacked extension in chrome://extensions. The extension icon should appear in the toolbar. Clicking it should open an empty side panel.

---

### STEP 2: Shared Types and Message Protocol

Define the type system that all three contexts (content script, service worker, side panel) share. This is critical — Chrome extension message passing is stringly-typed by default, and bugs here are painful to debug.

**src/shared/types.ts:**

```typescript
// ── Page State (output of DOM extractor) ──

export interface PageState {
  url: string;
  title: string;
  elements: ElementRef[];
  visibleText: string;
  meta: PageMeta;
}

export interface ElementRef {
  ref: string;          // "@e1", "@e2", etc.
  tag: string;          // "button", "a", "input", etc.
  role: string;         // ARIA role: "button", "link", "textbox", etc.
  name: string;         // Accessible name (button text, label, aria-label)
  value?: string;       // Current value for inputs/selects
  state?: string;       // "disabled" | "checked" | "expanded" | "selected"
  type?: string;        // Input type: "text", "email", "search", etc.
  context?: string;     // Nearest heading/landmark ancestor
  sensitive?: boolean;  // True if password/payment field (value will be redacted)
}

export interface PageMeta {
  hasForm: boolean;
  hasTable: boolean;
  scrollPercent: number;       // 0-100
  loadingState: 'loading' | 'interactive' | 'complete';
  elementCount: number;        // Total interactive elements found
}

// ── Agent Actions (LLM output) ──

export type AgentAction =
  | { action: 'click'; ref: string; reason?: string }
  | { action: 'type'; ref: string; text: string; reason?: string }
  | { action: 'select'; ref: string; value: string; reason?: string }
  | { action: 'scroll'; direction: 'up' | 'down'; reason?: string }
  | { action: 'navigate'; url: string; reason?: string }
  | { action: 'extract'; question: string; reason?: string }
  | { action: 'ask_human'; question: string; options?: string[] }
  | { action: 'wait'; ms: number; reason?: string }
  | { action: 'done'; result: string };

// ── Agent State ──

export type AgentStatus = 'idle' | 'thinking' | 'acting' | 'asking' | 'error';

export interface AgentHistoryEntry {
  step: number;
  action: AgentAction;
  result: string;
  timestamp: number;
}

// ── Settings ──

export type LLMProvider = 'anthropic' | 'openai' | 'ollama';

export interface Settings {
  provider: LLMProvider;
  apiKey: string;
  model: string;
  maxSteps: number;              // Safety limit (default 25)
  confirmSensitiveActions: boolean; // Default true
}
```

**src/shared/messages.ts:**

```typescript
import type { PageState, AgentAction, AgentStatus, AgentHistoryEntry } from './types';

// ── Messages: Service Worker ↔ Content Script ──

export type ContentRequest =
  | { type: 'GET_PAGE_STATE' }
  | { type: 'EXECUTE_ACTION'; action: AgentAction }
  | { type: 'EXTRACT_TEXT'; question: string }
  | { type: 'HIGHLIGHT_ELEMENT'; ref: string }
  | { type: 'CLEAR_HIGHLIGHTS' };

export type ContentResponse =
  | { type: 'PAGE_STATE'; state: PageState }
  | { type: 'ACTION_RESULT'; success: boolean; message: string }
  | { type: 'EXTRACT_RESULT'; answer: string }
  | { type: 'ERROR'; error: string };

// ── Messages: Side Panel ↔ Service Worker ──

export type PanelToBackground =
  | { type: 'START_TASK'; task: string }
  | { type: 'STOP_TASK' }
  | { type: 'HUMAN_RESPONSE'; approved: boolean; choice?: string }
  | { type: 'UPDATE_SETTINGS'; settings: Partial<Settings> }
  | { type: 'GET_SETTINGS' };

export type BackgroundToPanel =
  | { type: 'STATUS_UPDATE'; status: AgentStatus; message?: string }
  | { type: 'ACTION_TAKEN'; entry: AgentHistoryEntry }
  | { type: 'ASK_HUMAN'; question: string; options?: string[] }
  | { type: 'TASK_COMPLETE'; result: string }
  | { type: 'TASK_ERROR'; error: string }
  | { type: 'SETTINGS'; settings: Settings };
```

**src/shared/constants.ts:**

```typescript
export const MAX_ELEMENTS = 50;          // Cap interactive elements per snapshot
export const MAX_VISIBLE_TEXT = 2000;    // Characters of visible text to include
export const MAX_NAME_LENGTH = 80;       // Truncate element names
export const MAX_STEPS = 25;             // Default max agent loop iterations
export const PAGE_SETTLE_TIMEOUT = 5000; // Max wait for page to settle (ms)
export const PAGE_SETTLE_QUIET = 500;    // No DOM mutations for this long = settled
export const DEFAULT_MODEL = 'claude-sonnet-4-6';
export const DEFAULT_PROVIDER = 'anthropic';

// Actions that require human confirmation
export const SENSITIVE_ACTION_PATTERNS = [
  /purchas/i, /buy/i, /checkout/i, /pay/i, /order/i,
  /send/i, /submit/i, /post/i, /publish/i,
  /delete/i, /remove/i, /cancel/i,
  /sign.?up/i, /register/i, /create.?account/i,
  /password/i, /log.?in/i, /sign.?in/i,
];
```

---

### STEP 3: DOM Extractor (The Most Important File)

This is the heart of the product. Build it carefully.

**src/content/dom-extractor.ts:**

Requirements:
1. Walk all interactive elements on the page using querySelectorAll with these selectors:
   - `a[href]`, `button`, `input:not([type="hidden"])`, `select`, `textarea`
   - `[role="button"]`, `[role="link"]`, `[role="tab"]`, `[role="menuitem"]`, `[role="option"]`
   - `[role="textbox"]`, `[role="searchbox"]`, `[role="combobox"]`
   - `[onclick]`, `[contenteditable="true"]`
2. For each element, check visibility:
   - Skip elements with `display: none`, `visibility: hidden`, `opacity: 0`
   - Skip elements with zero dimensions (offsetWidth === 0 or offsetHeight === 0)
   - Skip elements far outside the viewport (more than 2x viewport height above or below current scroll)
3. For each visible element, compute:
   - `ref`: Sequential ID like "@e1", "@e2", etc.
   - `tag`: The HTML tag name (lowercase)
   - `role`: Use `el.getAttribute('role')` if set, otherwise infer from tag (button→"button", a→"link", input→"textbox", select→"listbox")
   - `name`: Compute the accessible name using this priority:
     a. `aria-label` attribute
     b. `aria-labelledby` → find referenced element's text content
     c. Associated `<label>` element (via `for` attribute matching input `id`)
     d. `title` attribute
     e. `textContent` (trimmed, truncated to 80 chars, collapse whitespace)
     f. `placeholder` attribute
     g. `alt` attribute (for images inside buttons/links)
     h. Fallback: "(unlabeled)"
   - `value`: For inputs/selects, get current value. For checkboxes/radios, get checked state.
   - `state`: "disabled" if disabled, "checked" if checked, "expanded" if aria-expanded="true"
   - `type`: For inputs, include the type attribute
   - `sensitive`: True if it's a password field, credit card field, etc. (delegate to sensitive-detector.ts)
   - `context`: Find nearest ancestor that is a heading (h1-h6), landmark (nav, main, aside, footer), or has an aria-label, and include its text as context hint
4. Cap the total elements at MAX_ELEMENTS (50). If more, prioritize:
   - Elements in the viewport first
   - Then elements near the viewport
   - Drop elements far from viewport
5. Extract visible text:
   - Get `document.body.innerText` (which respects CSS visibility)
   - Truncate to MAX_VISIBLE_TEXT characters
   - Collapse consecutive whitespace and blank lines
6. Store the ref→element mapping in a module-level Map so that action-executor.ts can look up elements by ref later

The function signature:

```typescript
// Stores the ref → actual DOM element mapping for action execution
const refMap = new Map<string, Element>();

export function extractPageState(): PageState {
  // ... implementation
  // Must populate refMap so action-executor can find elements by @ref
}

export function getElementByRef(ref: string): Element | null {
  return refMap.get(ref) ?? null;
}
```

**Format the output for the LLM as a string:**

```typescript
export function formatPageStateForLLM(state: PageState): string {
  let output = `URL: ${state.url}\nTitle: ${state.title}\n\n`;
  output += `Interactive elements:\n`;
  for (const el of state.elements) {
    let line = `  ${el.ref}  [${el.role}]  "${el.name}"`;
    if (el.value !== undefined) {
      line += el.sensitive ? ` value=[REDACTED]` : ` value="${el.value}"`;
    }
    if (el.state) line += ` (${el.state})`;
    if (el.context) line += ` in: ${el.context}`;
    output += line + '\n';
  }
  if (state.visibleText) {
    output += `\nVisible text:\n${state.visibleText}\n`;
  }
  output += `\n[${state.meta.elementCount} elements, scroll: ${state.meta.scrollPercent}%, ${state.meta.loadingState}]`;
  return output;
}
```

---

### STEP 4: Sensitive Field Detector

**src/content/sensitive-detector.ts:**

Detect fields that contain sensitive information. Values of these fields must be redacted before sending to the LLM.

Check for:
- `input[type="password"]`
- `input[autocomplete]` containing: cc-number, cc-exp, cc-csc, cc-name, current-password, new-password
- Element name, id, or class matching patterns: /passw/i, /credit.?card/i, /card.?num/i, /cvv/i, /cvc/i, /ssn/i, /social.?sec/i, /bank.?account/i, /routing.?num/i, /secret/i, /token/i

```typescript
export function isSensitiveElement(el: Element): boolean {
  // ... check all patterns above
}
```

---

### STEP 5: Action Executor

**src/content/action-executor.ts:**

Execute actions returned by the LLM. Uses the refMap from dom-extractor to find target elements.

```typescript
import { getElementByRef } from './dom-extractor';
import type { AgentAction } from '../shared/types';

export async function executeAction(action: AgentAction): Promise<{ success: boolean; message: string }> {
  switch (action.action) {
    case 'click': {
      const el = getElementByRef(action.ref);
      if (!el) return { success: false, message: `Element ${action.ref} not found` };
      (el as HTMLElement).click();
      return { success: true, message: `Clicked "${getAccessibleName(el)}"` };
    }
    case 'type': {
      const el = getElementByRef(action.ref) as HTMLInputElement;
      if (!el) return { success: false, message: `Element ${action.ref} not found` };
      el.focus();
      // Must dispatch events that React/Angular/Vue listen to
      el.value = action.text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { success: true, message: `Typed "${action.text}" into "${getAccessibleName(el)}"` };
    }
    case 'select': {
      const el = getElementByRef(action.ref) as HTMLSelectElement;
      if (!el) return { success: false, message: `Element ${action.ref} not found` };
      el.value = action.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { success: true, message: `Selected "${action.value}" in "${getAccessibleName(el)}"` };
    }
    case 'scroll': {
      const amount = action.direction === 'down' ? 600 : -600;
      window.scrollBy({ top: amount, behavior: 'smooth' });
      return { success: true, message: `Scrolled ${action.direction}` };
    }
    case 'navigate': {
      window.location.href = action.url;
      return { success: true, message: `Navigating to ${action.url}` };
    }
    case 'wait': {
      await new Promise(resolve => setTimeout(resolve, action.ms));
      return { success: true, message: `Waited ${action.ms}ms` };
    }
    default:
      return { success: false, message: `Unknown action: ${(action as any).action}` };
  }
}
```

Important implementation notes for action-executor:
- For `type` actions: You MUST dispatch both `input` and `change` events with `bubbles: true`. Modern frameworks (React, Angular, Vue) listen for these synthetic events, not native keyboard events. Without bubbling events, React controlled inputs won't update their state.
- For `click` actions: Use `el.click()` which triggers the full event chain (mousedown, mouseup, click). This works for both native buttons and framework-bound click handlers.
- For `navigate`: Simply setting `window.location.href` triggers a full navigation. The content script on the new page will be a fresh instance.

---

### STEP 6: Element Highlighter

**src/content/element-highlighter.ts:**

When the agent acts on an element, briefly highlight it so the user can see what's happening.

- Create a fixed-position overlay div with a colored border (green, 2px solid, with a subtle glow)
- Position it exactly over the target element using `getBoundingClientRect()`
- Show it for 800ms, then fade out over 200ms
- Include a small label showing the action ("Clicking", "Typing", etc.)
- Use a unique class name with a prefix like `fast-browser-highlight-` to avoid CSS conflicts
- Use `pointer-events: none` so the highlight doesn't interfere with clicking
- Clean up all highlight elements when the extension is deactivated

---

### STEP 7: Page Monitor

**src/content/page-monitor.ts:**

Detect when the page has "settled" after an action (navigation, AJAX load, DOM mutation).

```typescript
export function waitForPageSettled(opts?: { timeout?: number; quiet?: number }): Promise<void> {
  const timeout = opts?.timeout ?? PAGE_SETTLE_TIMEOUT;  // 5000ms max
  const quiet = opts?.quiet ?? PAGE_SETTLE_QUIET;         // 500ms of no mutations

  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout>;
    let observer: MutationObserver;

    const done = () => {
      observer?.disconnect();
      clearTimeout(timer);
      resolve();
    };

    // Resolve after `quiet` ms of no DOM mutations
    const resetQuietTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(done, quiet);
    };

    // Watch for DOM changes
    observer = new MutationObserver(resetQuietTimer);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });

    // Start the quiet timer
    resetQuietTimer();

    // Hard timeout — resolve even if mutations continue
    setTimeout(done, timeout);
  });
}
```

---

### STEP 8: Content Script Entry Point

**src/content/content-script.ts:**

Wire up the message handler that the service worker uses to communicate with the content script.

```typescript
import { extractPageState, formatPageStateForLLM } from './dom-extractor';
import { executeAction } from './action-executor';
import { highlightElement, clearHighlights } from './element-highlighter';
import { waitForPageSettled } from './page-monitor';
import type { ContentRequest, ContentResponse } from '../shared/messages';

chrome.runtime.onMessage.addListener(
  (message: ContentRequest, _sender, sendResponse: (response: ContentResponse) => void) => {
    handleMessage(message).then(sendResponse);
    return true; // Required for async sendResponse
  }
);

async function handleMessage(message: ContentRequest): Promise<ContentResponse> {
  switch (message.type) {
    case 'GET_PAGE_STATE': {
      const state = extractPageState();
      return { type: 'PAGE_STATE', state };
    }
    case 'EXECUTE_ACTION': {
      // Highlight the target element if it has a ref
      if ('ref' in message.action) {
        highlightElement(message.action.ref, message.action.action);
      }
      const result = await executeAction(message.action);
      // Wait for page to settle after action
      await waitForPageSettled();
      return { type: 'ACTION_RESULT', ...result };
    }
    case 'HIGHLIGHT_ELEMENT': {
      highlightElement(message.ref);
      return { type: 'ACTION_RESULT', success: true, message: 'Highlighted' };
    }
    case 'CLEAR_HIGHLIGHTS': {
      clearHighlights();
      return { type: 'ACTION_RESULT', success: true, message: 'Cleared' };
    }
    default:
      return { type: 'ERROR', error: `Unknown message type` };
  }
}
```

---

### STEP 9: LLM Client

**src/background/llm-client.ts:**

Abstract LLM provider interface. Start with Anthropic (Claude) only. Add others later.

```typescript
import type { Settings } from '../shared/types';

interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function callLLM(
  systemPrompt: string,
  messages: LLMMessage[],
  settings: Settings
): Promise<string> {
  switch (settings.provider) {
    case 'anthropic':
      return callAnthropic(systemPrompt, messages, settings);
    case 'openai':
      return callOpenAI(systemPrompt, messages, settings);
    case 'ollama':
      return callOllama(systemPrompt, messages, settings);
    default:
      throw new Error(`Unknown provider: ${settings.provider}`);
  }
}
```

**src/background/llm-providers/anthropic.ts:**

```typescript
export async function callAnthropic(
  systemPrompt: string,
  messages: LLMMessage[],
  settings: Settings
): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: settings.model || 'claude-sonnet-4-6',
      max_tokens: 256, // Actions are tiny — cap output hard
      system: systemPrompt,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.content[0].text;
}
```

---

### STEP 10: Agent Loop

**src/background/agent-loop.ts:**

The core orchestrator. Implements the observe→plan→act→verify cycle.

The system prompt for the LLM (embed this as a constant string):

```
You are Fast Browser, a browser automation agent. You control Chrome by reading the page structure and issuing actions.

You receive the current page as a list of interactive elements with reference IDs (@e1, @e2...) and visible text.

## Actions (respond with exactly ONE as JSON)

{"action":"click","ref":"@e5","reason":"Click search"}
{"action":"type","ref":"@e3","text":"Tokyo","reason":"Enter destination"}
{"action":"select","ref":"@e7","value":"Economy","reason":"Set cabin class"}
{"action":"scroll","direction":"down","reason":"See more results"}
{"action":"navigate","url":"https://...","reason":"Go to site"}
{"action":"extract","question":"What is the cheapest price?","reason":"Read prices"}
{"action":"ask_human","question":"Should I select this $892 flight?","options":["Yes","No","Show more"]}
{"action":"wait","ms":1000,"reason":"Page loading"}
{"action":"done","result":"The cheapest flight is United $892, 14h 10m, 1 stop"}

## Rules

1. NEVER interact with password or payment fields.
2. ALWAYS ask_human before: purchases, sending messages, deleting data, creating accounts.
3. If a CAPTCHA appears, ask_human.
4. If stuck after 3 failed attempts on the same element, ask_human.
5. Respond with ONLY the JSON object. No other text.
6. Keep "reason" under 10 words.
7. Use "extract" instead of scrolling through a long page to find information.
8. If the task is complete, use "done" with a clear summary of what you found/did.
```

Implementation requirements for agent-loop.ts:
1. Store agent history as an array of `{ role: 'assistant', content: actionJSON }` and `{ role: 'user', content: pageStateText }` messages
2. History goes FIRST in the messages array (cacheable by the LLM)
3. Current page state goes LAST (new each step, not cached)
4. Parse the LLM response as JSON. If parsing fails, retry once with a reminder to respond in JSON only
5. Before executing, check if the action requires human approval:
   - `ask_human` actions always pause
   - `click` actions where the element name matches SENSITIVE_ACTION_PATTERNS
   - `navigate` actions to domains different from the current page
   - Any action targeting a sensitive element (el.sensitive === true)
6. Send status updates to the side panel via chrome.runtime.sendMessage after each step
7. Cap at maxSteps (default 25) and stop with an error message if exceeded
8. Handle errors gracefully — if an action fails, include the error in the next LLM call so it can try a different approach

---

### STEP 11: Service Worker

**src/background/service-worker.ts:**

The main entry point. Routes messages between the side panel, content scripts, and the agent loop.

```typescript
import { runAgentLoop, stopAgentLoop } from './agent-loop';
import type { PanelToBackground } from '../shared/messages';
import type { Settings } from '../shared/types';

// Open side panel when extension icon is clicked
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Load settings from chrome.storage.local
let settings: Settings = {
  provider: 'anthropic',
  apiKey: '',
  model: 'claude-sonnet-4-6',
  maxSteps: 25,
  confirmSensitiveActions: true,
};

chrome.storage.local.get('settings', (result) => {
  if (result.settings) settings = { ...settings, ...result.settings };
});

// Handle messages from side panel
chrome.runtime.onMessage.addListener((message: PanelToBackground, sender, sendResponse) => {
  switch (message.type) {
    case 'START_TASK':
      runAgentLoop(message.task, settings);
      sendResponse({ ok: true });
      break;
    case 'STOP_TASK':
      stopAgentLoop();
      sendResponse({ ok: true });
      break;
    case 'HUMAN_RESPONSE':
      // Forward to agent loop's pending approval resolver
      resolveHumanResponse(message.approved, message.choice);
      sendResponse({ ok: true });
      break;
    case 'UPDATE_SETTINGS':
      settings = { ...settings, ...message.settings };
      chrome.storage.local.set({ settings });
      sendResponse({ ok: true });
      break;
    case 'GET_SETTINGS':
      sendResponse({ type: 'SETTINGS', settings });
      break;
  }
  return true;
});
```

---

### STEP 12: Side Panel UI

Build the React side panel with these components:

**App.tsx:** Two views — main chat view and settings view. Toggle with a gear icon.

**ChatInput.tsx:** A text input at the bottom of the panel (like a chat app). On submit, sends `START_TASK` message to service worker. Disabled while agent is running.

**ActionFeed.tsx:** A scrollable list of ActionCard components. Auto-scrolls to bottom on new entries.

**ActionCard.tsx:** Displays one agent action:
- Icon based on action type (✓ for completed, ⏳ for in-progress, ❌ for failed)
- Short description: "Clicked 'Search flights'" / "Typed 'Tokyo' into 'Destination'" / "Scrolled down"
- Subtle timestamp
- Green left border for success, red for failure, amber for in-progress

**ConfirmDialog.tsx:** Appears when agent needs human approval:
- Shows the question from the agent
- If options are provided, show them as buttons
- Otherwise show "Approve" and "Deny" buttons
- Blocks further agent actions until responded

**StatusIndicator.tsx:** Shows current agent state at the top of the panel:
- IDLE: "Ready" (gray dot)
- THINKING: "Reading page..." (pulsing blue dot)
- ACTING: "Executing..." (pulsing green dot)
- ASKING: "Waiting for your input" (amber dot)
- ERROR: "Something went wrong" (red dot)

**SettingsView.tsx:**
- LLM provider dropdown (Anthropic, OpenAI, Ollama)
- API key input (password field)
- Model selector (text input, shows default)
- "Test Connection" button that makes a simple LLM call to verify the key works
- Save button (persists to chrome.storage.local)

**WelcomeView.tsx:** Shown on first run (when no API key is configured):
- Brief explanation of what Fast Browser does
- Steps to get an API key
- Input field for the key
- "Get Started" button

**Styling guidelines:**
- Use Tailwind CSS utilities
- Dark theme by default (dark background matches Chrome's side panel aesthetic)
- Compact — the side panel is narrow (~320px wide)
- Use system fonts for performance
- Smooth transitions between states (200ms ease)
- The overall feel should be: clean, minimal, professional — not flashy

---

## Testing Checklist

After building all steps, verify these scenarios work:

### Scenario 1: Basic navigation
1. Open google.com
2. Open Fast Browser side panel
3. Type: "search for weather in San Francisco"
4. Agent should: type in the search box → click search → report results
5. Should complete in < 15 seconds (3-5 steps)

### Scenario 2: Information extraction
1. Open any news article
2. Type: "summarize this article in 3 bullet points"
3. Agent should: use extract action → return summary → done
4. Should complete in < 5 seconds (1-2 steps)

### Scenario 3: Human approval
1. Open gmail.com (logged in)
2. Type: "compose a new email to test@example.com saying hello"
3. Agent should: click compose → fill fields → ASK HUMAN before sending
4. Should NOT send without explicit approval

### Scenario 4: Sensitive field protection
1. Open any login page
2. Type: "fill in the login form"
3. Agent should: NOT type into password fields, NOT read password values
4. Should explain it cannot interact with sensitive fields

---

## Performance Targets

| Metric | Target | How to Measure |
|--------|--------|----------------|
| DOM extraction time | < 50ms | console.time() in dom-extractor |
| Page state token count | 200-500 tokens | Character count / 4 |
| LLM response time | 1-3s | Time from fetch to response |
| Action execution time | < 100ms | console.time() in action-executor |
| Page settle detection | < 2s typical | Time in waitForPageSettled |
| **Total per step** | **< 4s** | Sum of above |
| **10-step task** | **< 40s** | End-to-end timing |

---

## What NOT to Build (Keep Scope Tight)

- ❌ No recipe engine yet (Phase 3)
- ❌ No multi-tab support yet (Phase 3)
- ❌ No screenshot capability (defeats the purpose)
- ❌ No MCP server (CLI users have agent-browser already)
- ❌ No user accounts or cloud storage
- ❌ No browser history or bookmark access
- ❌ No payment processing or subscription logic
- ❌ No background task scheduling

Focus exclusively on: DOM extraction → LLM planning → action execution → side panel UI. Get the core loop fast and reliable before adding anything else.
