# Fast Browser — Swarm Audit & Fix Prompt

## Context

Fast Browser is a Chrome Extension (Manifest V3) that uses an LLM agent to automate browser tasks via natural language. Architecture: React side panel (Zustand state) ↔ Chrome Port ↔ Background service worker (agent loop) ↔ Content script (DOM extraction + action execution). Supports Anthropic, OpenAI, and Ollama providers.

**Current state**: 9/9 tests pass, TypeScript clean, build succeeds. Solid prototype proving the observe→plan→act→verify loop. But: prompt injection vulnerable, no LLM timeout, API keys stored plaintext, no max_tokens on OpenAI/Ollama, JSON parsing fragile, test coverage ~40%, no action verification after execution.

**Project path**: `/Users/maryliu/fast-browser/`

---

## Agent 1: Security Hardening

**Files**: `src/background/agent-loop.ts`, `src/background/llm-client.ts`, `src/shared/security.ts`, `src/shared/settings.ts`, `manifest.config.ts`

### 1A. Sanitize page text against prompt injection
**File**: `src/background/agent-loop.ts` — `formatPageState()`

Page visible text and element names are injected raw into the LLM prompt. An adversarial page can embed JSON that the model copies as its action.

**Fix**: Escape angle brackets and JSON-like patterns in visible text before including in prompt:
```typescript
function sanitizeForPrompt(text: string): string {
  return text
    .replace(/[{}\[\]]/g, (ch) => `\\${ch}`)
    .replace(/```/g, "\\`\\`\\`")
    .slice(0, 1500);
}
```
Apply to `visibleText` in `formatPageState()` and to element `name`/`context`/`value` fields.

### 1B. Add max_tokens to OpenAI/Ollama calls
**File**: `src/background/llm-client.ts`

Anthropic path has `max_tokens: 400` but OpenAI/Ollama path has none — model can generate arbitrarily long responses.

**Fix**: Add `max_tokens: 400` to the OpenAI/Ollama request body alongside `temperature: 0`.

### 1C. Add LLM call timeout
**File**: `src/background/llm-client.ts`

No timeout on fetch calls. If model hangs, the run hangs forever.

**Fix**: Create an AbortSignal with timeout:
```typescript
const timeoutSignal = AbortSignal.timeout(30_000);
const combined = AbortSignal.any([signal, timeoutSignal]);
```
Pass `combined` to `fetch()` instead of the raw `signal`. Catch `TimeoutError` and throw a descriptive error.

### 1D. Update Anthropic API version
**File**: `src/background/llm-client.ts`

Hardcoded `'anthropic-version': '2023-06-01'` is 3 years old.

**Fix**: Update to `'2025-01-01'` or the latest documented version.

### 1E. Differentiate HTTP error codes in LLM client
**File**: `src/background/llm-client.ts`

All errors return generic message. 401 (bad key), 429 (rate limit), and 500 (server error) should be distinguished.

**Fix**:
```typescript
if (response.status === 401) throw new Error(`${settings.provider}: Invalid API key`);
if (response.status === 429) throw new Error(`${settings.provider}: Rate limited — wait and retry`);
if (response.status >= 500) throw new Error(`${settings.provider}: Server error (${response.status})`);
throw new Error(`${settings.provider}: Request failed (${response.status})`);
```

### 1F. Add URL validation to settings
**File**: `src/shared/settings.ts` — `validateProviderSettings()`

`baseUrl` accepts any string including `":::"`.

**Fix**: Add URL format validation:
```typescript
if (settings.baseUrl) {
  try { new URL(settings.baseUrl); } 
  catch { return 'Base URL is not a valid URL'; }
}
```

---

## Agent 2: Agent Loop Robustness

**Files**: `src/background/agent-loop.ts`, `src/background/service-worker.ts`

### 2A. Robust JSON parsing for agent actions
**File**: `src/background/agent-loop.ts` — `parseAgentAction()`

The parser handles markdown fences but fails on edge cases (escaped quotes, trailing commas, text before/after JSON).

**Fix**: Replace the current parsing with a more resilient approach:
```typescript
function parseAgentAction(raw: string): AgentAction {
  // Strip markdown fences
  let cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  
  // Find the first { and last } to extract JSON even with surrounding text
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error(`No JSON object found in model response: ${raw.slice(0, 120)}`);
  }
  cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  
  // Strip trailing commas before } (common LLM mistake)
  cleaned = cleaned.replace(/,\s*}/g, '}');
  
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Invalid JSON from model: ${(err as Error).message}\nRaw: ${raw.slice(0, 200)}`);
  }
  
  // ... existing validation logic
}
```

### 2B. Add action verification (post-execution state check)
**File**: `src/background/agent-loop.ts` — inside the main loop

After executing an action, the loop gets new page state but doesn't verify the action had the intended effect.

**Fix**: After each action execution, add a simple verification step:
```typescript
// After execute + getPageState:
if (action.action === 'click') {
  // Check if the clicked element is no longer in the same state
  // (e.g., dialog opened, page navigated, element changed)
  const clickedRef = action.ref;
  const stillExists = newPageState.elements.some(el => el.ref === clickedRef);
  if (stillExists) {
    const el = newPageState.elements.find(e => e.ref === clickedRef);
    if (el && el.state === previousElement?.state) {
      deps.emitEvent(makeFeedEntry('warning', `Click on ${clickedRef} may not have had effect`));
    }
  }
}
```

### 2C. Make maxSteps configurable
**File**: `src/background/agent-loop.ts`

Hardcoded `maxSteps = 6`. Should be configurable per run.

**Fix**: Add `maxSteps` to the function signature with default 6, and pass it from the service worker's `FAST_BROWSER_RUN_START` handler. Add a `maxSteps` field to `RunStartClientMessage` in `messages.ts`.

### 2D. Add retry logic for transient LLM failures
**File**: `src/background/agent-loop.ts` — in the plan phase

If the LLM call fails with a transient error (429, 500, timeout), retry once after a delay.

**Fix**: Wrap the `callModel` invocation:
```typescript
let rawAction: string;
try {
  rawAction = await deps.callModel(messages, signal);
} catch (err) {
  if (isRetryableError(err) && !signal.aborted) {
    deps.emitEvent(makeFeedEntry('warning', 'Model call failed, retrying in 2s...'));
    await abortableDelay(2000, signal);
    rawAction = await deps.callModel(messages, signal);
  } else {
    throw err;
  }
}
```

---

## Agent 3: Content Script Improvements

**Files**: `src/content/dom-extractor.ts`, `src/content/action-executor.ts`, `src/content/content-script.ts`

### 3A. Increase element cap from 40 to 60
**File**: `src/content/dom-extractor.ts`

40 elements is too few for complex pages. Many important interactive elements get dropped.

**Fix**: Change the slice limit from 40 to 60. Also increase visible text from 1500 to 2500 chars.

### 3B. Improve type action to dispatch keyboard events
**File**: `src/content/action-executor.ts` — `executeType()`

Current implementation sets `.value` directly and dispatches `input`/`change` events. This misses keystroke handlers that many SPAs rely on.

**Fix**: Simulate actual keystrokes for better compatibility:
```typescript
async function executeType(el: HTMLElement, text: string): Promise<void> {
  el.scrollIntoView({ block: 'center', behavior: 'instant' });
  el.focus();
  
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.value = '';
    // Set value character by character for better SPA compatibility
    for (const char of text) {
      el.value += char;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: char, inputType: 'insertText' }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (el.isContentEditable) {
    el.textContent = text;
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }
}
```

### 3C. Improve click action to use dispatchEvent instead of .click()
**File**: `src/content/action-executor.ts` — `executeClick()`

`.click()` doesn't set MouseEvent properties some handlers check.

**Fix**: Use `dispatchEvent(new MouseEvent(...))`:
```typescript
async function executeClick(el: HTMLElement): Promise<void> {
  el.scrollIntoView({ block: 'center', behavior: 'instant' });
  el.focus();
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
}
```

### 3D. Add scroll verification
**File**: `src/content/action-executor.ts` — `executeScroll()`

After scrolling, doesn't verify the page actually scrolled.

**Fix**: Check `scrollY` before and after:
```typescript
async function executeScroll(direction: 'up' | 'down'): Promise<void> {
  const before = window.scrollY;
  const delta = Math.round(window.innerHeight * 0.8);
  window.scrollBy({ top: direction === 'down' ? delta : -delta, behavior: 'instant' });
  // Allow a tick for scroll to take effect
  await new Promise(r => setTimeout(r, 50));
  if (window.scrollY === before) {
    throw new Error(`Scroll ${direction} had no effect (already at ${direction === 'down' ? 'bottom' : 'top'})`);
  }
}
```

---

## Agent 4: UI Polish

**Files**: `src/sidepanel/App.tsx`, `src/sidepanel/components/ActionFeed.tsx`, `src/sidepanel/stores/agent-store.ts`, `src/styles.css`

### 4A. Add loading spinner during agent run
**File**: `src/sidepanel/App.tsx`

No visual feedback during LLM calls. User doesn't know if the agent is thinking or stuck.

**Fix**: Add a pulsing indicator when phase is 'plan':
```tsx
{phase === 'plan' && (
  <div className="flex items-center gap-2 text-blue-400 text-sm animate-pulse">
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
    Thinking...
  </div>
)}
```

### 4B. Cap feed size to prevent memory leak
**File**: `src/sidepanel/stores/agent-store.ts`

Feed array grows unbounded.

**Fix**: In `appendFeed`, trim to last 200 entries:
```typescript
appendFeed: (entry) => set((s) => ({ 
  feed: [...s.feed, entry].slice(-200) 
})),
```

### 4C. Add settings validation in the UI
**File**: `src/sidepanel/App.tsx` — settings panel

No validation on settings inputs.

**Fix**: Before saving, call `validateProviderSettings()` and show inline errors:
```tsx
const error = validateProviderSettings(settings);
if (error) {
  setSettingsError(error);
  return;
}
```
Show `settingsError` as red text below the form.

### 4D. Add connection retry on port disconnect
**File**: `src/sidepanel/App.tsx`

If the port disconnects mid-run, the UI freezes with no recovery.

**Fix**: In the port `onDisconnect` handler, if run was in flight:
```typescript
port.onDisconnect.addListener(() => {
  if (phaseRef.current && !['done', 'error', 'cancelled'].includes(phaseRef.current)) {
    useAgentStore.getState().setPhase('error');
    useAgentStore.getState().setError('Connection lost. Try running again.');
  }
  runnerPortRef.current = null;
});
```

---

## Agent 5: Test Coverage Expansion

**Files**: `tests/*.test.ts`

### 5A. Expand action-executor tests
**File**: `tests/action-executor.test.ts`

Add tests for:
- Type action happy path (non-sensitive field)
- Type into contentEditable element
- Click on disabled button (should reject)
- Scroll down and verify scroll position changed
- Element disconnected from DOM (should throw)
- Wait action with minimum enforcement (50ms floor)

### 5B. Expand agent-loop tests
**File**: `tests/agent-loop.test.ts`

Add tests for:
- Model returns invalid JSON → error with descriptive message
- Model returns JSON with unknown action type → error
- Navigate action triggers page state refresh
- Max steps exceeded → returns with error
- Retry on transient LLM failure (after fix 2D)
- History accumulation (verify callModel receives prior actions)

### 5C. Expand dom-extractor tests
**File**: `tests/dom-extractor.test.ts`

Add tests for:
- Hidden element (display:none) excluded from extraction
- aria-hidden element excluded
- Element with aria-label gets correct name
- Form detection (hasForm in meta)
- Empty page returns valid PageState with 0 elements
- More than 60 elements → truncated to 60 (after fix 3A)
- Sensitive field value shows [REDACTED]

### 5D. Add new test file: `tests/llm-client.test.ts`
Test the LLM client with mocked fetch:
- Anthropic happy path → returns content text
- OpenAI happy path → returns choice message content
- 401 error → descriptive "Invalid API key" message
- 429 error → "Rate limited" message
- Timeout → descriptive timeout error
- Empty response body → descriptive error
- max_tokens is set in request body for all providers

### 5E. Add new test file: `tests/security.test.ts`
Test sensitive element detection:
- `type="password"` → sensitive
- `autocomplete="cc-number"` → sensitive
- `name="cvv"` → sensitive
- `name="username"` → NOT sensitive
- `name="email"` → NOT sensitive
- Regular text input → NOT sensitive

---

## Agent 6: Documentation & Build

**Files**: `README.md`, `package.json`, `manifest.config.ts`

### 6A. Update README with current architecture
Add a section describing:
- The observe→plan→act→verify loop with diagram
- Message flow: sidepanel ↔ port ↔ service worker ↔ content script
- Supported action types and their behavior
- Security model (sensitive field detection, human approval for cross-origin nav)
- Known limitations (no iframes, no shadow DOM, 60 element cap)

### 6B. Add npm audit fix
Run `npm audit fix` to address the 2 high-severity dependency vulnerabilities.

### 6C. Add Content Security Policy to manifest
**File**: `manifest.config.ts`

Add CSP to prevent XSS:
```typescript
content_security_policy: {
  extension_pages: "script-src 'self'; object-src 'none';",
},
```

### 6D. Narrow host permissions for production
Document that `<all_urls>` should be replaced with `activeTab` permission + optional host permissions requested at runtime via `chrome.permissions.request()` for production deployment.

---

## Verification Checklist

```bash
cd /Users/maryliu/fast-browser

# TypeScript compiles
npx tsc --noEmit

# All tests pass (should be 20+ after expansion)
npm test

# Build succeeds
npm run build

# No audit vulnerabilities
npm audit
```
