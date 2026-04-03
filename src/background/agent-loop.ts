import type { LlmMessage } from './llm-client';
import type {
  ActionFeedEntry,
  AgentAction,
  AgentRunResult,
  ExecutableAction,
  NavigateAction,
  PageState,
  ProviderSettings,
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
  getPageState: () => Promise<PageState>;
  executeAction: (action: ExecutableAction, snapshotId: string) => Promise<void>;
  navigate: (action: NavigateAction) => Promise<void>;
  callModel: (systemPrompt: string, messages: LlmMessage[], settings: ProviderSettings) => Promise<string>;
}

interface AgentLoopOptions {
  task: string;
  settings: ProviderSettings;
  maxSteps?: number;
}

function makeFeedEntry(message: string, kind: ActionFeedEntry['kind'] = 'info'): ActionFeedEntry {
  return {
    id: crypto.randomUUID(),
    kind,
    message,
    timestamp: new Date().toISOString(),
  };
}

function formatPageState(pageState: PageState): string {
  const lines = pageState.elements.map((element) => {
    const details = [
      element.tag,
      element.role,
      element.type,
      element.state?.join(','),
      element.context,
      element.inViewport ? 'in viewport' : 'off screen',
      element.sensitive ? 'sensitive' : undefined,
    ].filter(Boolean).join(' · ');

    return `${element.ref} | ${element.name} | ${details}`;
  });

  return [
    `URL: ${pageState.url}`,
    `Title: ${pageState.title}`,
    `Snapshot: ${pageState.snapshotId}`,
    `Visible text:\n${pageState.visibleText || '(none)'}`,
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

function parseAgentAction(raw: string): AgentAction {
  const trimmed = raw.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
  const candidate = fencedMatch?.[1] ?? trimmed;
  const parsed = JSON.parse(candidate) as Partial<AgentAction>;
  if (!parsed || typeof parsed !== 'object' || typeof parsed.action !== 'string') {
    throw new Error('The model did not return a valid action.');
  }

  switch (parsed.action) {
    case 'click':
      if (typeof parsed.ref === 'string') return { action: 'click', ref: parsed.ref, reason: parsed.reason ?? 'Click target' };
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

export async function runAgentLoop(
  options: AgentLoopOptions,
  deps: AgentLoopDependencies,
): Promise<AgentRunResult> {
  const maxSteps = options.maxSteps ?? 6;
  const feed: ActionFeedEntry[] = [];
  const history: AgentAction[] = [];
  let currentPage = await deps.getPageState();

  feed.push(makeFeedEntry(`Observed ${currentPage.meta.elementCount} interactive elements.`, 'success'));

  for (let step = 1; step <= maxSteps; step += 1) {
    feed.push(makeFeedEntry(`Planning step ${step}.`));
    const rawAction = await deps.callModel(
      AGENT_SYSTEM_PROMPT,
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
    );

    const action = parseAgentAction(rawAction);
    history.push(action);
    feed.push(makeFeedEntry(`Model chose ${action.action}: ${action.reason}`));

    const approvalReason = requiresHumanApproval(action, currentPage);
    if (approvalReason) {
      return {
        ok: true,
        pageState: currentPage,
        feed: [...feed, makeFeedEntry(approvalReason, 'warning')],
        finalMessage: approvalReason,
      };
    }

    if (action.action === 'ask_human') {
      return {
        ok: true,
        pageState: currentPage,
        feed: [...feed, makeFeedEntry(action.question, 'warning')],
        finalMessage: action.question,
      };
    }

    if (action.action === 'done') {
      return {
        ok: true,
        pageState: currentPage,
        feed: [...feed, makeFeedEntry(action.result, 'success')],
        finalMessage: action.result,
      };
    }

    if (action.action === 'navigate') {
      await deps.navigate(action);
      currentPage = await deps.getPageState();
      feed.push(makeFeedEntry(`Navigated to ${currentPage.url}.`, 'success'));
      continue;
    }

    if (!isExecutableAction(action)) {
      return {
        ok: false,
        pageState: currentPage,
        feed,
        error: 'Unsupported non-executable action.',
      };
    }

    try {
      await deps.executeAction(action, currentPage.snapshotId);
      currentPage = await deps.getPageState();
      feed.push(makeFeedEntry(`Executed ${action.action} and refreshed the page snapshot.`, 'success'));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown action failure.';
      feed.push(makeFeedEntry(message, 'error'));
      return {
        ok: false,
        pageState: currentPage,
        feed,
        error: message,
      };
    }
  }

  return {
    ok: false,
    pageState: currentPage,
    feed,
    error: `Stopped after ${maxSteps} steps without completing the task.`,
  };
}
