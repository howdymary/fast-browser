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

function parseAgentAction(raw: string): AgentAction {
  let parsedValue: unknown;
  const candidate = extractJsonCandidate(raw);

  try {
    parsedValue = JSON.parse(candidate);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown JSON parse error';
    throw new Error(`Invalid JSON from model: ${message}. Raw response: ${raw.slice(0, 200)}`);
  }

  const parsed = parsedValue as Partial<AgentAction>;
  if (!parsed || typeof parsed !== 'object' || typeof parsed.action !== 'string') {
    throw new Error(`The model did not return a valid action: ${raw.slice(0, 120)}`);
  }

  switch (parsed.action) {
    case 'click':
      if (typeof parsed.ref === 'string') {
        return { action: 'click', ref: parsed.ref, reason: parsed.reason ?? 'Click target' };
      }
      break;
    case 'type':
      if (typeof parsed.ref === 'string' && typeof parsed.text === 'string') {
        return { action: 'type', ref: parsed.ref, text: parsed.text, reason: parsed.reason ?? 'Type text' };
      }
      break;
    case 'scroll':
      if (parsed.direction === 'up' || parsed.direction === 'down') {
        return { action: 'scroll', direction: parsed.direction, reason: parsed.reason ?? 'Scroll page' };
      }
      break;
    case 'navigate':
      if (typeof parsed.url === 'string') {
        return { action: 'navigate', url: parsed.url, reason: parsed.reason ?? 'Navigate' };
      }
      break;
    case 'wait':
      if (typeof parsed.ms === 'number') {
        return { action: 'wait', ms: parsed.ms, reason: parsed.reason ?? 'Wait briefly' };
      }
      break;
    case 'ask_human':
      if (typeof parsed.question === 'string') {
        return { action: 'ask_human', question: parsed.question, reason: parsed.reason ?? 'Need confirmation' };
      }
      break;
    case 'done':
      if (typeof parsed.result === 'string') {
        return { action: 'done', result: parsed.result, reason: parsed.reason ?? 'Task complete' };
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
  messages: LlmMessage[],
  settings: ProviderSettings,
  pageState: PageState,
): Promise<string> {
  try {
    return await deps.callModel(AGENT_SYSTEM_PROMPT, messages, settings, deps.signal);
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
    return deps.callModel(AGENT_SYSTEM_PROMPT, messages, settings, deps.signal);
  }
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
        action = parseAgentAction(rawAction);
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
