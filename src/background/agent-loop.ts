import type { LlmMessage } from './llm-client';
import { sanitizePromptText } from '../shared/security';
import type {
  ActionFeedEntry,
  AgentAction,
  AgentRunResult,
  ExecutableAction,
  NavigateAction,
  PageState,
  ProviderSettings,
  RunPhase,
} from '../shared/types';

const AGENT_SYSTEM_PROMPT = `
You are Fast Browser, a browser automation agent running inside Chrome.

You receive:
- the user's task
- the current page snapshot
- the recent action history

Respond with exactly one JSON object and nothing else.

Allowed actions:
{"action":"click","ref":"@e4","reason":"Open the search form"}
{"action":"type","ref":"@e2","text":"San Francisco weather","reason":"Fill the query"}
{"action":"scroll","direction":"down","reason":"See more results"}
{"action":"navigate","url":"https://www.google.com","reason":"Open the search engine"}
{"action":"wait","ms":800,"reason":"Wait for the page"}
{"action":"ask_human","question":"I need confirmation before clicking this sensitive control.","reason":"Sensitive action"}
{"action":"done","result":"I completed the task.","reason":"Task complete"}

Rules:
1. Only use refs that appear in the current page snapshot.
2. Prefer acting on the current page before navigating elsewhere.
3. Never type into sensitive fields.
4. If the page is missing the controls you need, navigate explicitly.
5. If you are uncertain or the page looks risky, use ask_human.
6. Keep reasons under 12 words.
7. Do not return {"actions":[...]}, arrays, plans, or wrapper objects.
8. If you think multiple steps are needed, return only the immediate next action object.
`.trim();

const READ_ONLY_SYSTEM_PROMPT = `
You are Fast Browser, a browser agent answering from the current page snapshot.

The user's task is read-only. Do not click, type, scroll, wait, or navigate.

Respond with exactly one JSON object and nothing else.

Use one of these:
{"action":"done","result":"Three concise bullets summarizing the page.","reason":"Summarized the page"}
{"action":"ask_human","question":"I do not have enough page information to answer accurately.","reason":"Need more context"}

Rules:
1. Answer only from the current page snapshot and visible text you were given.
2. If the page snapshot is sufficient, return done immediately.
3. Do not propose extra browsing actions for a summary or explanation request.
4. Output must be a single top-level action object with an "action" field.
5. The "result" field must be a single string, not an array or nested object.
`.trim();

export interface AgentLoopDependencies {
  signal: AbortSignal;
  getPageState: () => Promise<PageState>;
  executeAction: (action: ExecutableAction, snapshotId: string) => Promise<void>;
  navigate: (action: NavigateAction) => Promise<void>;
  callModel: (
    systemPrompt: string,
    messages: LlmMessage[],
    settings: ProviderSettings,
    signal?: AbortSignal,
  ) => Promise<string>;
  emitEvent?: (event: {
    step: number;
    phase: RunPhase;
    entry?: ActionFeedEntry;
    pageState?: PageState;
  }) => Promise<void> | void;
}

interface AgentLoopOptions {
  task: string;
  settings: ProviderSettings;
  maxSteps?: number;
}

export function makeFeedEntry(
  message: string,
  kind: ActionFeedEntry['kind'] = 'info',
): ActionFeedEntry {
  return {
    id: crypto.randomUUID(),
    kind,
    message,
    timestamp: new Date().toISOString(),
  };
}

function throwIfAborted(signal: AbortSignal): void {
  signal.throwIfAborted();
}

async function emitEvent(
  deps: AgentLoopDependencies,
  event: Parameters<NonNullable<AgentLoopDependencies['emitEvent']>>[0],
): Promise<void> {
  throwIfAborted(deps.signal);
  if (deps.emitEvent) {
    await deps.emitEvent(event);
  }
}

function formatPageState(pageState: PageState): string {
  const sanitize = sanitizePromptText;

  const lines = pageState.elements.map((element) => {
    const details = [
      sanitize(element.ref),
      sanitize(element.tag),
      sanitize(element.role),
      element.type ? sanitize(element.type) : undefined,
      element.state?.length ? sanitize(element.state.join(',')) : undefined,
      element.context ? sanitize(element.context) : undefined,
      element.inViewport ? 'in viewport' : 'off screen',
      element.sensitive ? 'sensitive' : undefined,
    ].filter(Boolean).join(' · ');

    const name = element.name ? sanitize(element.name) : '';
    const value = element.value ? sanitize(element.value) : undefined;
    const valueSuffix = value ? ` = ${value}` : '';

    return `${sanitize(element.ref)} | ${name}${valueSuffix} | ${details}`;
  });

  return [
    `URL: ${sanitize(pageState.url)}`,
    `Title: ${sanitize(pageState.title)}`,
    `Snapshot: ${sanitize(pageState.snapshotId)}`,
    `Visible text:\n${sanitize(pageState.visibleText || '(none)')}`,
    'Interactive elements:',
    lines.join('\n') || '(none)',
  ].join('\n\n');
}

function formatHistory(history: AgentAction[]): string {
  if (history.length === 0) {
    return 'No prior actions.';
  }
  return history.map((action, index) => `${index + 1}. ${JSON.stringify(action)}`).join('\n');
}

function isReadOnlyTask(task: string): boolean {
  const normalized = task.toLowerCase();
  const trimmed = normalized.trim();
  const readOnlyPatterns = [
    /\bsummar(?:ize|y)\b/,
    /\bexplain\b/,
    /\bdescribe\b/,
    /^\s*(what|when|where|who|why|how)\b.+\??$/,
    /\bwhat does this page say\b/,
    /\bwhat is on this page\b/,
    /\bwhat(?:'s| is)\b.+\b(this page|current page|page|site|article|title|heading|summary|about)\b/,
    /\b(tell me|show me)\b.+\b(this page|current page|page|site|article|title|heading|summary|about)\b/,
    /\b(page|this page|current page|site|article)\b.+\b(title|heading|summary|about|say|show|mean)\b/,
    /\b(article|page|site)\b.+\b(published|updated|written|author|title|heading)\b/,
    /\b(published|updated|written|author|title|heading)\b.+\b(article|page|site)\b/,
    /\b(title|main heading|summary|key points)\b.+\b(page|this page|current page|article|site)\b/,
    /\blist\b.+\b(bullets|bullet points|headings|key points)\b/,
    /\bextract\b.+\b(title|heading|summary|main points)\b/,
  ];
  const interactivePatterns = [
    /\bclick\b/,
    /\btype\b/,
    /\bfill\b/,
    /\bsearch\b/,
    /\blog ?in\b/,
    /\bsign ?in\b/,
    /\bnavigate\b/,
    /\bopen\b.+\b(tab|page|link|menu|dialog)\b/,
    /\bscroll\b/,
    /\bfocus\b/,
  ];

  const looksReadOnly = readOnlyPatterns.some((pattern) => pattern.test(normalized));
  const looksInteractive = interactivePatterns.some((pattern) => pattern.test(normalized));
  const looksLikeQuestion = trimmed.endsWith('?') && !looksInteractive;
  return (looksReadOnly || looksLikeQuestion) && !looksInteractive;
}

function repairJsonCandidate(candidate: string): string {
  return candidate
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_-]*)(\s*:)/g, '$1"$2"$3')
    .replace(/:\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_match, value: string) => `:${JSON.stringify(value.replace(/\\'/g, '\''))}`);
}

function extractJsonCandidate(raw: string): string {
  const trimmed = raw.trim().replace(/^\uFEFF/, '');
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
  let candidate = fencedMatch?.[1] ?? trimmed;

  const firstTokenIndex = candidate.search(/[\[{]/);
  if (firstTokenIndex > 0) {
    candidate = candidate.slice(firstTokenIndex);
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  let endIndex = -1;

  for (let index = 0; index < candidate.length; index += 1) {
    const char = candidate[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{' || char === '[') {
      depth += 1;
      continue;
    }

    if (char === '}' || char === ']') {
      depth -= 1;
      if (depth === 0) {
        endIndex = index;
        break;
      }
    }
  }

  if (endIndex !== -1) {
    candidate = candidate.slice(0, endIndex + 1);
  }

  candidate = candidate.replace(/,\s*([}\]])/g, '$1');
  return candidate.trim();
}

function unwrapActionPayload(parsedValue: unknown): { value: unknown; warning?: string } {
  if (Array.isArray(parsedValue) && parsedValue.length > 0) {
    return {
      value: parsedValue[0],
      warning: 'Model returned an action array. Fast Browser used the first step only.',
    };
  }

  if (!parsedValue || typeof parsedValue !== 'object') {
    return { value: parsedValue };
  }

  const record = parsedValue as Record<string, unknown>;
  if (typeof record.action === 'string') {
    return { value: record };
  }

  if (Array.isArray(record.actions) && record.actions.length > 0) {
    return {
      value: record.actions[0],
      warning: 'Model returned a multi-step plan. Fast Browser used only the first action.',
    };
  }

  if (record.next_action && typeof record.next_action === 'object') {
    return {
      value: record.next_action,
      warning: 'Model returned a wrapped next_action. Fast Browser unwrapped it.',
    };
  }

  return { value: parsedValue };
}

function normalizeModelText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((item) => normalizeModelText(item))
      .filter((item): item is string => Boolean(item));

    if (parts.length === 0) {
      return null;
    }

    if (parts.length === 1) {
      return parts[0];
    }

    return parts.map((item) => (item.startsWith('- ') ? item : `- ${item}`)).join('\n');
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const preferredKeys = ['result', 'summary', 'answer', 'content', 'text', 'message'];
    for (const key of preferredKeys) {
      const normalized = normalizeModelText(record[key]);
      if (normalized) {
        return normalized;
      }
    }
  }

  return null;
}

function parseAgentAction(raw: string): { action: AgentAction; warning?: string } {
  let parsedValue: unknown;
  const candidate = extractJsonCandidate(raw);

  try {
    parsedValue = JSON.parse(candidate);
  } catch (error) {
    const repairedCandidate = repairJsonCandidate(candidate);
    if (repairedCandidate !== candidate) {
      try {
        parsedValue = JSON.parse(repairedCandidate);
      } catch {
        const message = error instanceof Error ? error.message : 'Unknown JSON parse error';
        throw new Error(`Invalid JSON from model: ${message}. Raw response: ${raw.slice(0, 200)}`);
      }
    } else {
      const message = error instanceof Error ? error.message : 'Unknown JSON parse error';
      throw new Error(`Invalid JSON from model: ${message}. Raw response: ${raw.slice(0, 200)}`);
    }
  }

  const unwrapped = unwrapActionPayload(parsedValue);
  const parsed = unwrapped.value as Partial<AgentAction>;
  if (!parsed || typeof parsed !== 'object' || typeof parsed.action !== 'string') {
    throw new Error(`The model did not return a valid action: ${raw.slice(0, 120)}`);
  }

  switch (parsed.action) {
    case 'click':
      if (typeof parsed.ref === 'string') {
        return { action: { action: 'click', ref: parsed.ref, reason: parsed.reason ?? 'Click target' }, warning: unwrapped.warning };
      }
      break;
    case 'type':
      if (typeof parsed.ref === 'string' && typeof parsed.text === 'string') {
        return { action: { action: 'type', ref: parsed.ref, text: parsed.text, reason: parsed.reason ?? 'Type text' }, warning: unwrapped.warning };
      }
      break;
    case 'scroll':
      if (parsed.direction === 'up' || parsed.direction === 'down') {
        return { action: { action: 'scroll', direction: parsed.direction, reason: parsed.reason ?? 'Scroll page' }, warning: unwrapped.warning };
      }
      break;
    case 'navigate':
      if (typeof parsed.url === 'string') {
        return { action: { action: 'navigate', url: parsed.url, reason: parsed.reason ?? 'Navigate' }, warning: unwrapped.warning };
      }
      break;
    case 'wait':
      if (typeof parsed.ms === 'number') {
        return { action: { action: 'wait', ms: parsed.ms, reason: parsed.reason ?? 'Wait briefly' }, warning: unwrapped.warning };
      }
      break;
    case 'ask_human':
      {
        const question = normalizeModelText(parsed.question);
        if (question) {
          return { action: { action: 'ask_human', question, reason: parsed.reason ?? 'Need confirmation' }, warning: unwrapped.warning };
        }
      }
      break;
    case 'done':
      {
        const result = normalizeModelText(parsed.result);
        if (result) {
          return { action: { action: 'done', result, reason: parsed.reason ?? 'Task complete' }, warning: unwrapped.warning };
        }
      }
      break;
    default:
      break;
  }

  throw new Error(`Unsupported or malformed action: ${candidate}`);
}

function isExecutableAction(action: AgentAction): action is ExecutableAction {
  return action.action === 'click'
    || action.action === 'type'
    || action.action === 'scroll'
    || action.action === 'wait';
}

const RISKY_CLICK_NAME_RE = /\b(sign in|log in|login|continue|submit|authorize|approve|confirm|delete|remove|purchase|pay|checkout|place order|transfer|send)\b/i;
const AUTH_CONTEXT_RE = /\b(sign in|log in|login|password|two-factor|verification|account)\b/i;
const PAYMENT_CONTEXT_RE = /\b(payment|checkout|card|billing|purchase|order|transfer|bank)\b/i;
const DESTRUCTIVE_CONTEXT_RE = /\b(delete|remove|erase|destroy|unsubscribe|cancel plan)\b/i;

function isHighRiskClickTarget(
  target: PageState['elements'][number] | undefined,
  pageState: PageState,
): boolean {
  if (!target) {
    return false;
  }

  const haystack = `${target.name} ${target.context ?? ''}`.trim();
  if (!RISKY_CLICK_NAME_RE.test(haystack)) {
    return false;
  }

  const sameContextElements = pageState.elements.filter((element) => (
    (element.context ?? '') === (target.context ?? '')
  ));
  const pageHasSensitiveField = pageState.elements.some((element) => element.sensitive);
  const contextHasSensitiveField = sameContextElements.some((element) => element.sensitive);

  return AUTH_CONTEXT_RE.test(haystack)
    || PAYMENT_CONTEXT_RE.test(haystack)
    || DESTRUCTIVE_CONTEXT_RE.test(haystack)
    || contextHasSensitiveField
    || pageHasSensitiveField;
}

function requiresHumanApproval(action: AgentAction, pageState: PageState): string | null {
  if (action.action === 'navigate') {
    try {
      const destination = new URL(action.url, pageState.url);
      const current = new URL(pageState.url);
      if (destination.origin !== current.origin) {
        return `Cross-site navigation to ${destination.origin} needs approval.`;
      }
    } catch {
      return 'Navigation target is invalid.';
    }
  }

  if (action.action === 'click' || action.action === 'type') {
    const target = pageState.elements.find((element) => element.ref === action.ref);
    if (target?.sensitive) {
      return `Element ${action.ref} is marked sensitive.`;
    }
    if (action.action === 'click' && isHighRiskClickTarget(target, pageState)) {
      return `Clicking ${target?.name || action.ref} needs confirmation because it may submit or change something important.`;
    }
  }

  return null;
}

function getElementSignature(element: PageState['elements'][number] | undefined): string {
  if (!element) {
    return 'missing';
  }
  return JSON.stringify({
    tag: element.tag,
    role: element.role,
    name: element.name,
    type: element.type,
    state: element.state ?? [],
    value: element.value ?? '',
    visible: element.inViewport,
  });
}

function findComparableElement(
  pageState: PageState,
  target: PageState['elements'][number] | undefined,
): PageState['elements'][number] | undefined {
  if (!target) {
    return undefined;
  }

  return pageState.elements.find((element) => (
    element.tag === target.tag
    && element.role === target.role
    && element.name === target.name
    && element.context === target.context
  ));
}

function verifyActionEffect(
  action: AgentAction,
  previousPage: PageState,
  currentPage: PageState,
): string | null {
  if (action.action === 'click') {
    const previousTarget = previousPage.elements.find((element) => element.ref === action.ref);
    const currentTarget = findComparableElement(currentPage, previousTarget);
    const pageChanged = previousPage.url !== currentPage.url
      || previousPage.visibleText !== currentPage.visibleText
      || previousPage.meta.hasDialog !== currentPage.meta.hasDialog
      || previousPage.meta.elementCount !== currentPage.meta.elementCount;
    if (
      previousTarget
      && currentTarget
      && getElementSignature(previousTarget) === getElementSignature(currentTarget)
      && !pageChanged
    ) {
      return `Click on ${previousTarget.name || action.ref} may not have changed the page.`;
    }
  }

  if (action.action === 'type') {
    const previousTarget = previousPage.elements.find((element) => element.ref === action.ref);
    const currentTarget = findComparableElement(currentPage, previousTarget);
    if (!currentTarget || currentTarget.value !== action.text) {
      return `Typing into ${previousTarget?.name || action.ref} may not have updated the field.`;
    }
  }

  if (action.action === 'scroll' && previousPage.meta.scrollPercent === currentPage.meta.scrollPercent) {
    return `Scroll ${action.direction} may not have moved the page.`;
  }

  if (action.action === 'navigate' && previousPage.url === currentPage.url) {
    return `Navigation to ${action.url} may not have completed.`;
  }

  return null;
}

function cancelledResult(): AgentRunResult {
  return {
    ok: false,
    feed: [makeFeedEntry('Run cancelled.', 'warning')],
    error: 'Run cancelled.',
  };
}

function isTransientModelError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes('rate limited')
    || message.includes('server error')
    || message.includes('timeout')
    || message.includes('request failed (429)')
    || message.includes('request failed (5')
    || message.includes('temporarily unavailable');
}

function isRetryablePageChangeError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes('page reloaded or rerendered')
    || message.includes('page changed before the action could run')
    || (message.includes('element') && message.includes('no longer available'))
    || message.includes('could not connect to the page script')
    || message.includes('message port closed before a response was received')
    || message.includes('receiving end does not exist');
}

async function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      signal.removeEventListener('abort', handleAbort);
      resolve();
    }, ms);

    function handleAbort(): void {
      globalThis.clearTimeout(timeoutId);
      signal.removeEventListener('abort', handleAbort);
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    }

    signal.addEventListener('abort', handleAbort, { once: true });
  });
}

async function callModelWithRetry(
  deps: AgentLoopDependencies,
  step: number,
  feed: ActionFeedEntry[],
  systemPrompt: string,
  messages: LlmMessage[],
  settings: ProviderSettings,
  pageState: PageState,
): Promise<string> {
  try {
    return await deps.callModel(systemPrompt, messages, settings, deps.signal);
  } catch (error) {
    if (deps.signal.aborted || !isTransientModelError(error)) {
      throw error;
    }

    const warningEntry = makeFeedEntry('Model call failed, retrying in 2s...', 'warning');
    feed.push(warningEntry);
    await emitEvent(deps, {
      step,
      phase: 'plan',
      entry: warningEntry,
      pageState,
    });

    await abortableDelay(2000, deps.signal);
    throwIfAborted(deps.signal);
    return deps.callModel(systemPrompt, messages, settings, deps.signal);
  }
}

async function repromptForReadOnlyAnswer(
  deps: AgentLoopDependencies,
  step: number,
  feed: ActionFeedEntry[],
  settings: ProviderSettings,
  task: string,
  history: AgentAction[],
  currentPage: PageState,
  rejectedAction: AgentAction,
): Promise<AgentAction> {
  const warningEntry = makeFeedEntry(
    `The model proposed ${rejectedAction.action} for a read-only question. Asking for a direct answer instead.`,
    'warning',
  );
  feed.push(warningEntry);
  await emitEvent(deps, {
    step,
    phase: 'plan',
    entry: warningEntry,
    pageState: currentPage,
  });

  const rawAction = await callModelWithRetry(
    deps,
    step,
    feed,
    READ_ONLY_SYSTEM_PROMPT,
    [
      {
        role: 'user',
        content: [
          `Task: ${task}`,
          `History:\n${formatHistory(history)}`,
          `Current page:\n${formatPageState(currentPage)}`,
        ].join('\n\n'),
      },
      {
        role: 'assistant',
        content: JSON.stringify(rejectedAction),
      },
      {
        role: 'user',
        content: 'That was a browsing action. This task is read-only. Return only a single {"action":"done",...} or {"action":"ask_human",...} object based on the current page snapshot.',
      },
    ],
    settings,
    currentPage,
  );

  const parsedAction = parseAgentAction(rawAction);
  if (parsedAction.warning) {
    const parsedWarningEntry = makeFeedEntry(parsedAction.warning, 'warning');
    feed.push(parsedWarningEntry);
    await emitEvent(deps, {
      step,
      phase: 'plan',
      entry: parsedWarningEntry,
      pageState: currentPage,
    });
  }

  if (parsedAction.action.action !== 'done' && parsedAction.action.action !== 'ask_human') {
    throw new Error('The model kept proposing browsing actions for a read-only question.');
  }

  return parsedAction.action;
}

export async function runAgentLoop(
  options: AgentLoopOptions,
  deps: AgentLoopDependencies,
): Promise<AgentRunResult> {
  try {
    const maxSteps = Number.isFinite(options.maxSteps)
      ? Math.max(1, Math.min(20, Math.floor(options.maxSteps ?? 6)))
      : 6;
    const feed: ActionFeedEntry[] = [];
    const history: AgentAction[] = [];
    const readOnlyTask = isReadOnlyTask(options.task);
    let readOnlyRepromptUsed = false;

    await emitEvent(deps, {
      step: 0,
      phase: 'observe',
    });

    let currentPage = await deps.getPageState();
    throwIfAborted(deps.signal);

    const observedEntry = makeFeedEntry(`Observed ${currentPage.meta.elementCount} interactive elements.`, 'success');
    feed.push(observedEntry);
    await emitEvent(deps, {
      step: 0,
      phase: 'observe',
      entry: observedEntry,
      pageState: currentPage,
    });

    for (let step = 1; step <= maxSteps; step += 1) {
      throwIfAborted(deps.signal);

      const planningEntry = makeFeedEntry(`Planning step ${step}.`);
      feed.push(planningEntry);
      await emitEvent(deps, {
        step,
        phase: 'plan',
        entry: planningEntry,
      });

      const rawAction = await callModelWithRetry(
        deps,
        step,
        feed,
        readOnlyTask ? READ_ONLY_SYSTEM_PROMPT : AGENT_SYSTEM_PROMPT,
        [
          {
            role: 'user',
            content: [
              `Task: ${options.task}`,
              `History:\n${formatHistory(history)}`,
              `Current page:\n${formatPageState(currentPage)}`,
            ].join('\n\n'),
          },
        ],
        options.settings,
        currentPage,
      );
      throwIfAborted(deps.signal);

      let action: AgentAction;
      try {
        const parsedAction = parseAgentAction(rawAction);
        action = parsedAction.action;
        if (parsedAction.warning) {
          const warningEntry = makeFeedEntry(parsedAction.warning, 'warning');
          feed.push(warningEntry);
          await emitEvent(deps, {
            step,
            phase: 'plan',
            entry: warningEntry,
            pageState: currentPage,
          });
        }
        if (
          readOnlyTask
          && action.action !== 'done'
          && action.action !== 'ask_human'
        ) {
          if (readOnlyRepromptUsed) {
            throw new Error('The model kept proposing browsing actions for a read-only question.');
          }
          readOnlyRepromptUsed = true;
          action = await repromptForReadOnlyAnswer(
            deps,
            step,
            feed,
            options.settings,
            options.task,
            history,
            currentPage,
            action,
          );
        }
      } catch (parseError) {
        const message = parseError instanceof Error ? parseError.message : 'Failed to parse model response.';
        const errorEntry = makeFeedEntry(message, 'error');
        feed.push(errorEntry);
        await emitEvent(deps, {
          step,
          phase: 'error',
          entry: errorEntry,
          pageState: currentPage,
        });
        return {
          ok: false,
          pageState: currentPage,
          feed,
          error: message,
        };
      }
      history.push(action);
      const plannedActionEntry = makeFeedEntry(`Model chose ${action.action}: ${action.reason}`);
      feed.push(plannedActionEntry);
      await emitEvent(deps, {
        step,
        phase: 'plan',
        entry: plannedActionEntry,
      });

      const approvalReason = requiresHumanApproval(action, currentPage);
      if (approvalReason) {
        const approvalEntry = makeFeedEntry(approvalReason, 'warning');
        feed.push(approvalEntry);
        await emitEvent(deps, {
          step,
          phase: 'awaiting-human',
          entry: approvalEntry,
          pageState: currentPage,
        });
        return {
          ok: true,
          pageState: currentPage,
          feed,
          finalMessage: approvalReason,
        };
      }

      if (action.action === 'ask_human') {
        const askEntry = makeFeedEntry(action.question, 'warning');
        feed.push(askEntry);
        await emitEvent(deps, {
          step,
          phase: 'awaiting-human',
          entry: askEntry,
          pageState: currentPage,
        });
        return {
          ok: true,
          pageState: currentPage,
          feed,
          finalMessage: action.question,
        };
      }

      if (action.action === 'done') {
        const doneEntry = makeFeedEntry(action.result, 'success');
        feed.push(doneEntry);
        await emitEvent(deps, {
          step,
          phase: 'done',
          entry: doneEntry,
          pageState: currentPage,
        });
        return {
          ok: true,
          pageState: currentPage,
          feed,
          finalMessage: action.result,
        };
      }

      if (action.action === 'navigate') {
        const navigateEntry = makeFeedEntry(`Starting navigate: ${action.reason}`);
        feed.push(navigateEntry);
        await emitEvent(deps, {
          step,
          phase: 'act',
          entry: navigateEntry,
        });
        await deps.navigate(action);
        throwIfAborted(deps.signal);
        currentPage = await deps.getPageState();
        throwIfAborted(deps.signal);
        const verifyNavigateEntry = makeFeedEntry(`Navigated to ${currentPage.url}.`, 'success');
        feed.push(verifyNavigateEntry);
        await emitEvent(deps, {
          step,
          phase: 'verify',
          entry: verifyNavigateEntry,
          pageState: currentPage,
        });
        continue;
      }

      if (!isExecutableAction(action)) {
        const errorEntry = makeFeedEntry('Unsupported non-executable action.', 'error');
        feed.push(errorEntry);
        await emitEvent(deps, {
          step,
          phase: 'error',
          entry: errorEntry,
          pageState: currentPage,
        });
        return {
          ok: false,
          pageState: currentPage,
          feed,
          error: 'Unsupported non-executable action.',
        };
      }

      try {
        const actEntry = makeFeedEntry(`Starting ${action.action}: ${action.reason}`);
        feed.push(actEntry);
        await emitEvent(deps, {
          step,
          phase: 'act',
          entry: actEntry,
        });
        await deps.executeAction(action, currentPage.snapshotId);
        throwIfAborted(deps.signal);

        const actionDoneEntry = makeFeedEntry(`Executed ${action.action}.`, 'success');
        feed.push(actionDoneEntry);
        await emitEvent(deps, {
          step,
          phase: 'act',
          entry: actionDoneEntry,
        });

        const refreshedPage = await deps.getPageState();
        throwIfAborted(deps.signal);

        const verifyWarning = verifyActionEffect(action, currentPage, refreshedPage);
        if (verifyWarning) {
          const warningEntry = makeFeedEntry(verifyWarning, 'warning');
          feed.push(warningEntry);
          await emitEvent(deps, {
            step,
            phase: 'verify',
            entry: warningEntry,
            pageState: refreshedPage,
          });
        }

        currentPage = refreshedPage;

        const verifyEntry = makeFeedEntry(`Refreshed the page snapshot after ${action.action}.`, 'success');
        feed.push(verifyEntry);
        await emitEvent(deps, {
          step,
          phase: 'verify',
          entry: verifyEntry,
          pageState: currentPage,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          throw error;
        }
        if (isRetryablePageChangeError(error)) {
          const recoveryEntry = makeFeedEntry('The page changed mid-step. Refreshing the snapshot and replanning...', 'warning');
          feed.push(recoveryEntry);
          await emitEvent(deps, {
            step,
            phase: 'verify',
            entry: recoveryEntry,
            pageState: currentPage,
          });

          try {
            currentPage = await deps.getPageState();
            throwIfAborted(deps.signal);
            const refreshedEntry = makeFeedEntry('Got a fresh page snapshot after the page changed.', 'success');
            feed.push(refreshedEntry);
            await emitEvent(deps, {
              step,
              phase: 'verify',
              entry: refreshedEntry,
              pageState: currentPage,
            });
            continue;
          } catch (recoveryError) {
            if (recoveryError instanceof DOMException && recoveryError.name === 'AbortError') {
              throw recoveryError;
            }
            error = recoveryError;
          }
        }
        const message = error instanceof Error ? error.message : 'Unknown action failure.';
        const errorEntry = makeFeedEntry(message, 'error');
        feed.push(errorEntry);
        await emitEvent(deps, {
          step,
          phase: 'error',
          entry: errorEntry,
          pageState: currentPage,
        });
        return {
          ok: false,
          pageState: currentPage,
          feed,
          error: message,
        };
      }
    }

    const exhaustedEntry = makeFeedEntry(`Stopped after ${maxSteps} steps without completing the task.`, 'error');
    feed.push(exhaustedEntry);
    await emitEvent(deps, {
      step: maxSteps,
      phase: 'error',
      entry: exhaustedEntry,
      pageState: currentPage,
    });
    return {
      ok: false,
      pageState: currentPage,
      feed,
      error: `Stopped after ${maxSteps} steps without completing the task.`,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return cancelledResult();
    }
    throw error;
  }
}
