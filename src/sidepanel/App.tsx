import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';

import type {
  BackgroundResponse,
  RunEventServerMessage,
  RunFinishServerMessage,
  RunPortClientMessage,
  RunPortServerMessage,
} from '../shared/messages';
import type { ProviderSettings, RunPhase } from '../shared/types';
import { validateProviderSettings } from '../shared/settings';
import { ActionFeed } from './components/ActionFeed';
import { useAgentStore } from './stores/agent-store';
import { useSettingsStore } from './stores/settings-store';

interface FormErrors {
  task?: string;
  model?: string;
  endpoint?: string;
  apiKey?: string;
  maxSteps?: string;
}

interface SiteAccessState {
  status: 'unknown' | 'granted' | 'not-granted' | 'unsupported';
  label: string;
  origin?: string;
}

function validateRunForm(
  task: string,
  maxSteps: number,
  settings: ProviderSettings,
): FormErrors {
  const errors: FormErrors = {};

  if (!task.trim()) {
    errors.task = 'Enter a task before running the agent.';
  }

  if (!/^[a-zA-Z0-9._:/-]{1,128}$/.test(settings.model.trim())) {
    errors.model = 'Use only letters, numbers, . _ : / and - in the model name.';
  }

  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 20) {
    errors.maxSteps = 'Choose a whole number between 1 and 20.';
  }

  if (settings.provider === 'ollama') {
    if (!settings.baseUrl?.trim()) {
      errors.endpoint = 'Set an Ollama endpoint before running.';
    }
  } else if (settings.baseUrl?.trim()) {
    try {
      new URL(settings.baseUrl);
    } catch {
      errors.endpoint = 'Base URL must be a valid URL.';
    }
  }

  if (settings.provider !== 'ollama' && !settings.apiKey.trim()) {
    errors.apiKey = `An API key is required for ${settings.provider}.`;
  }

  return errors;
}

function statusLabelForPhase(phase: RunPhase | null): string {
  switch (phase) {
    case 'observe':
      return 'Reading the current page';
    case 'plan':
      return 'Planning the next step';
    case 'act':
      return 'Executing an action';
    case 'verify':
      return 'Verifying the result';
    case 'awaiting-human':
      return 'Waiting for confirmation';
    case 'error':
      return 'Needs attention';
    default:
      return 'Ready';
  }
}

function isSupportedPageUrl(url: string | undefined): boolean {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

function toOriginPattern(url: string): string {
  return `${new URL(url).origin}/*`;
}

async function getCurrentSiteAccess(): Promise<SiteAccessState> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url;
  if (!tab || !url || !isSupportedPageUrl(url)) {
    return {
      status: 'unsupported',
      label: 'Open a normal website tab to inspect or automate it.',
    };
  }

  const origin = new URL(url).origin;
  const pattern = toOriginPattern(url);
  const granted = await chrome.permissions.contains({ origins: [pattern] });

  return {
    status: granted ? 'granted' : 'not-granted',
    origin,
    label: granted
      ? `Persistent access granted for ${origin}.`
      : `Fast Browser can run on ${origin} now via the toolbar click, or you can grant persistent site access.`,
  };
}

export function App(): ReactElement {
  const {
    task,
    phase,
    currentRunId,
    lastSeq,
    pageState,
    feed,
    error,
    setTask,
    setPhase,
    setCurrentRunId,
    setLastSeq,
    setPageState,
    appendFeed,
    setError,
    resetFeed,
  } = useAgentStore();
  const {
    settings,
    loaded,
    updateSettings,
    load: loadSettings,
    save: saveSettings,
  } = useSettingsStore();
  const [maxSteps, setMaxSteps] = useState(6);
  const [validationAttempted, setValidationAttempted] = useState(false);
  const [siteAccess, setSiteAccess] = useState<SiteAccessState>({
    status: 'unknown',
    label: 'Checking site access…',
  });

  const runnerPortRef = useRef<chrome.runtime.Port | null>(null);
  const currentRunIdRef = useRef<string | null>(null);
  const lastSeqRef = useRef(0);
  const phaseRef = useRef<RunPhase | null>(null);
  const disconnectSuppressedRef = useRef(false);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    if (!loaded) {
      void loadSettings();
    }
  }, [loaded, loadSettings]);

  useEffect(() => {
    void getCurrentSiteAccess().then(setSiteAccess).catch(() => {
      setSiteAccess({
        status: 'unknown',
        label: 'Fast Browser could not determine current site access.',
      });
    });
  }, []);

  useEffect(() => {
    return () => {
      if (runnerPortRef.current && currentRunIdRef.current) {
        const cancelMessage: RunPortClientMessage = {
          type: 'FAST_BROWSER_RUN_CANCEL',
          runId: currentRunIdRef.current,
        };
        runnerPortRef.current.postMessage(cancelMessage);
        disconnectSuppressedRef.current = true;
        runnerPortRef.current.disconnect();
      }
      runnerPortRef.current = null;
      currentRunIdRef.current = null;
      lastSeqRef.current = 0;
    };
  }, []);

  const statusLabel = useMemo(() => statusLabelForPhase(phase), [phase]);
  const runInFlight = currentRunId !== null;
  const formErrors = useMemo<FormErrors>(
    () => (validationAttempted ? validateRunForm(task, maxSteps, settings) : {}),
    [maxSteps, settings, task, validationAttempted],
  );
  const hasValidationErrors = Object.keys(formErrors).length > 0;

  function cleanupRunnerPort(options?: { disconnect?: boolean }): void {
    currentRunIdRef.current = null;
    lastSeqRef.current = 0;
    setCurrentRunId(null);
    setLastSeq(0);
    const port = runnerPortRef.current;
    runnerPortRef.current = null;
    if (port && options?.disconnect !== false) {
      disconnectSuppressedRef.current = true;
      port.disconnect();
    }
  }

  function handleRunServerMessage(message: RunPortServerMessage): void {
    if (!currentRunIdRef.current) {
      return;
    }

    if (message.runId !== currentRunIdRef.current || message.seq <= lastSeqRef.current) {
      return;
    }

    lastSeqRef.current = message.seq;
    setLastSeq(message.seq);

    if (message.type === 'FAST_BROWSER_RUN_EVENT') {
      const event = message as RunEventServerMessage;
      setPhase(event.phase);
      if (event.entry) {
        appendFeed([event.entry]);
      }
      if (event.pageState) {
        setPageState(event.pageState);
      }
      return;
    }

    const finish = message as RunFinishServerMessage;
    if (finish.pageState) {
      setPageState(finish.pageState);
    }

    if (finish.error) {
      setError(finish.error);
    } else {
      setError(null);
    }

    if (phaseRef.current === 'awaiting-human') {
      setPhase('awaiting-human');
    } else if (finish.ok) {
      setPhase(null);
    } else if ((finish.error ?? '').match(/cancelled/i)) {
      setPhase(null);
    } else {
      setPhase('error');
    }

    cleanupRunnerPort();
  }

  async function handleInspectPage(): Promise<void> {
    setPhase('observe');
    setError(null);
    resetFeed();
    setSiteAccess(await getCurrentSiteAccess());

    const response = await chrome.runtime.sendMessage({
      type: 'FAST_BROWSER_INSPECT_PAGE',
      task: task.trim() || undefined,
    }) as BackgroundResponse;

    if (!response.ok || !response.pageState) {
      setPhase('error');
      setError(response.error ?? 'Unknown extension error.');
      appendFeed(response.feed ?? []);
      return;
    }

    setPageState(response.pageState);
    appendFeed(response.feed ?? []);
    setPhase(null);
  }

  async function handleRunAgent(): Promise<void> {
    setValidationAttempted(true);
    setSiteAccess(await getCurrentSiteAccess());

    const validationError = validateProviderSettings(settings);
    const nextFormErrors = validateRunForm(task, maxSteps, settings);
    if (validationError || Object.keys(nextFormErrors).length > 0) {
      setError(validationError ?? 'Fix the highlighted fields before running.');
      return;
    }

    await saveSettings();

    const runId = crypto.randomUUID();
    const port = chrome.runtime.connect({ name: 'fast-browser.run' });

    cleanupRunnerPort();
    runnerPortRef.current = port;
    currentRunIdRef.current = runId;
    lastSeqRef.current = 0;
    setCurrentRunId(runId);
    setLastSeq(0);
    setPhase('observe');
    setError(null);
    resetFeed();
    setPageState(null);

    function handleDisconnect(): void {
      if (disconnectSuppressedRef.current) {
        disconnectSuppressedRef.current = false;
        return;
      }

      if (currentRunIdRef.current === runId) {
        setPhase('error');
        setError('The background worker disconnected. Reopen the side panel and run the task again.');
      }
      cleanupRunnerPort({ disconnect: false });
    }

    port.onMessage.addListener(handleRunServerMessage);
    port.onDisconnect.addListener(handleDisconnect);

    const startMessage: RunPortClientMessage = {
      type: 'FAST_BROWSER_RUN_START',
      runId,
      task: task.trim(),
      maxSteps,
    };
    port.postMessage(startMessage);
  }

  async function handleGrantSiteAccess(): Promise<void> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url;
    if (!tab || !url || !isSupportedPageUrl(url)) {
      setSiteAccess({
        status: 'unsupported',
        label: 'Open a normal http(s) page before requesting site access.',
      });
      return;
    }

    const origin = new URL(url).origin;
    const originPattern = toOriginPattern(url);
    const granted = await chrome.permissions.request({ origins: [originPattern] });
    if (granted) {
      setSiteAccess({
        status: 'granted',
        origin,
        label: `Persistent access granted for ${origin}.`,
      });
      return;
    }

    setSiteAccess({
      status: 'not-granted',
      origin,
      label: `Persistent access for ${origin} was not granted. You can still use the temporary active-tab permission after opening the panel from the toolbar.`,
    });
  }

  const showWelcome = !pageState && feed.length === 0 && !runInFlight;

  function handleCancelRun(): void {
    if (!runnerPortRef.current || !currentRunIdRef.current) {
      return;
    }
    const cancelMessage: RunPortClientMessage = {
      type: 'FAST_BROWSER_RUN_CANCEL',
      runId: currentRunIdRef.current,
    };
    runnerPortRef.current.postMessage(cancelMessage);
  }

  return (
    <main className="min-h-screen px-4 py-5 text-slate-50">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <section className="rounded-3xl border border-slate-800 bg-slate-950/70 p-4 shadow-2xl shadow-slate-950/40">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-sky-400/30 bg-sky-500/10 text-sm font-semibold text-sky-200">
                  FB
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.25em] text-sky-300">Fast Browser</p>
                  <h1 className="mt-1 text-xl font-semibold">Alpha Extension</h1>
                </div>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                {phase ? `Live phase: ${phase}` : 'Task runner idle'}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {currentRunId ? `Run ${currentRunId.slice(0, 8)} · seq ${lastSeq}` : 'No active run'}
              </p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/70 px-3 py-1 text-xs text-slate-300">
              {phase === 'plan' ? (
                <span className="fast-browser-spinner h-2.5 w-2.5 rounded-full border border-sky-300 border-t-transparent" aria-hidden="true" />
              ) : null}
              {statusLabel}
            </div>
          </div>

          <label className="mt-4 block text-sm text-slate-300" htmlFor="task-input">
            Task prompt
          </label>
          <textarea
            id="task-input"
            className="mt-2 min-h-24 w-full rounded-2xl border border-slate-700 bg-slate-900/80 px-3 py-3 text-sm text-slate-50 outline-none ring-0 placeholder:text-slate-500 focus:border-sky-400"
            placeholder="Example: Find the primary search box and summarize the main calls to action on this page."
            value={task}
            onChange={(event) => setTask(event.target.value)}
          />
          {validationAttempted && formErrors.task ? (
            <p className="mt-2 text-xs text-rose-300">{formErrors.task}</p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              className="rounded-full bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
              onClick={() => { void handleInspectPage(); }}
              disabled={runInFlight}
            >
              Inspect page
            </button>
            <button
              type="button"
              className="rounded-full bg-emerald-400 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
              onClick={() => { void handleRunAgent(); }}
              disabled={runInFlight}
            >
              Run agent
            </button>
            <button
              type="button"
              className="rounded-full border border-amber-600 px-4 py-2 text-sm text-amber-200 transition hover:border-amber-400 hover:bg-amber-950/40 disabled:cursor-not-allowed disabled:border-slate-700 disabled:text-slate-500"
              onClick={handleCancelRun}
              disabled={!runInFlight}
            >
              Cancel run
            </button>
            <button
              type="button"
              className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500 hover:bg-slate-900 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-500"
              onClick={() => {
                setPageState(null);
                setError(null);
                resetFeed();
                setPhase(null);
                setValidationAttempted(false);
                cleanupRunnerPort();
              }}
              disabled={runInFlight}
            >
              Clear
            </button>
          </div>

          <div className="mt-4 grid gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-3 md:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400" htmlFor="provider-select">
                Provider
              </label>
              <select
                id="provider-select"
                className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50"
                value={settings.provider}
                onChange={(event) => updateSettings({ provider: event.target.value as typeof settings.provider })}
                disabled={runInFlight}
              >
                <option value="ollama">Ollama</option>
                <option value="openai">OpenAI-compatible</option>
                <option value="anthropic">Anthropic</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400" htmlFor="model-input">
                Model
              </label>
              <input
                id="model-input"
                className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50"
                value={settings.model}
                onChange={(event) => updateSettings({ model: event.target.value })}
                placeholder="llama3.2 or gpt-4.1-mini"
                disabled={runInFlight}
              />
              {validationAttempted && formErrors.model ? (
                <p className="mt-2 text-xs text-rose-300">{formErrors.model}</p>
              ) : null}
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400" htmlFor="base-url-input">
                Endpoint
              </label>
              <input
                id="base-url-input"
                className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50"
                value={settings.baseUrl ?? ''}
                onChange={(event) => updateSettings({ baseUrl: event.target.value })}
                placeholder="http://127.0.0.1:11434/v1/chat/completions"
                disabled={runInFlight}
              />
              {validationAttempted && formErrors.endpoint ? (
                <p className="mt-2 text-xs text-rose-300">{formErrors.endpoint}</p>
              ) : null}
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400" htmlFor="api-key-input">
                API key
              </label>
              <input
                id="api-key-input"
                type="password"
                className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50"
                value={settings.apiKey}
                onChange={(event) => updateSettings({ apiKey: event.target.value })}
                placeholder={settings.provider === 'ollama' ? 'Optional for local Ollama' : 'Required for this provider'}
                disabled={runInFlight}
              />
              {validationAttempted && formErrors.apiKey ? (
                <p className="mt-2 text-xs text-rose-300">{formErrors.apiKey}</p>
              ) : null}
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400" htmlFor="max-steps-input">
                Max steps
              </label>
              <input
                id="max-steps-input"
                type="number"
                min={1}
                max={20}
                className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50"
                value={Number.isFinite(maxSteps) ? maxSteps : ''}
                onChange={(event) => setMaxSteps(Number.parseInt(event.target.value, 10))}
                disabled={runInFlight}
              />
              <p className="mt-1 text-xs text-slate-500">Use 1 to 20 steps per run.</p>
              {validationAttempted && formErrors.maxSteps ? (
                <p className="mt-2 text-xs text-rose-300">{formErrors.maxSteps}</p>
              ) : null}
            </div>
          </div>

          {error ? (
            <div className="mt-4 rounded-2xl border border-rose-700/70 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
              {error}
            </div>
          ) : null}
          {validationAttempted && hasValidationErrors ? (
            <div className="mt-3 rounded-2xl border border-amber-700/70 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">
              Fix the highlighted fields before starting a run.
            </div>
          ) : null}

          <div className="mt-3 rounded-2xl border border-slate-800 bg-slate-900/60 px-3 py-3 text-sm text-slate-300">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Site access</div>
                <div className="mt-1">{siteAccess.label}</div>
              </div>
              <button
                type="button"
                className="rounded-full border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-slate-500 hover:bg-slate-900 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-500"
                onClick={() => { void handleGrantSiteAccess(); }}
                disabled={runInFlight || siteAccess.status === 'unsupported' || siteAccess.status === 'granted'}
              >
                {siteAccess.status === 'granted' ? 'Granted' : 'Grant this site'}
              </button>
            </div>
          </div>
        </section>

        {showWelcome ? (
          <section className="rounded-3xl border border-sky-900/60 bg-gradient-to-br from-sky-950/60 to-slate-950/80 p-4 shadow-xl shadow-slate-950/30">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-300">Quickstart</p>
            <h2 className="mt-2 text-lg font-semibold text-slate-50">Use Fast Browser on the current tab</h2>
            <p className="mt-2 text-sm text-slate-300">
              Fast Browser works best on normal web pages with a short, concrete task. Start with an inspect pass, then let the agent act one step at a time.
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-3">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">1. Open a site</div>
                <p className="mt-2 text-sm text-slate-300">Use a regular `http` or `https` page, not `chrome://` or another browser-internal tab.</p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-3">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">2. Configure a model</div>
                <p className="mt-2 text-sm text-slate-300">Ollama is the easiest local setup. Keys stay in session storage and are not persisted locally.</p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-3">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">3. Start small</div>
                <p className="mt-2 text-sm text-slate-300">Try tasks like “click the search box” or “summarize the main calls to action” before harder multi-step flows.</p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                className="rounded-full bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-sky-400"
                onClick={() => { void handleInspectPage(); }}
              >
                Inspect this page
              </button>
              <button
                type="button"
                className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500 hover:bg-slate-900"
                onClick={() => { void handleGrantSiteAccess(); }}
              >
                Grant persistent site access
              </button>
            </div>
          </section>
        ) : null}

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div className="rounded-3xl border border-slate-800 bg-slate-950/60 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-300">Action feed</h2>
              <span className="text-xs text-slate-500">One run per Port, ordered by seq</span>
            </div>
            <ActionFeed entries={feed} />
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-950/60 p-4">
            <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-300">Page snapshot</h2>
            {pageState ? (
              <div className="mt-3 space-y-4 text-sm text-slate-200">
                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
                  <div className="font-medium text-slate-50">{pageState.title || '(untitled page)'}</div>
                  <div className="mt-1 break-all text-xs text-slate-400">{pageState.url}</div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-300">
                    <div>Elements: {pageState.meta.elementCount}</div>
                    <div>Forms: {pageState.meta.hasForm ? 'yes' : 'no'}</div>
                    <div>Dialogs: {pageState.meta.hasDialog ? 'yes' : 'no'}</div>
                    <div>Scroll: {pageState.meta.scrollPercent}%</div>
                  </div>
                </div>

                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                    Top interactive elements
                  </h3>
                  <div className="max-h-80 space-y-2 overflow-auto pr-1">
                    {pageState.elements.map((element) => (
                      <div
                        key={element.ref}
                        className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2"
                      >
                        <div className="text-xs text-sky-300">{element.ref}</div>
                        <div className="mt-1 font-medium text-slate-50">{element.name}</div>
                        <div className="mt-1 text-xs text-slate-400">
                          {element.tag} · {element.role}
                          {element.type ? ` · ${element.type}` : ''}
                          {element.state ? ` · ${element.state}` : ''}
                          {element.inViewport ? ' · in viewport' : ' · off screen'}
                        </div>
                        {element.context ? (
                          <div className="mt-1 text-xs text-slate-500">Context: {element.context}</div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                    Visible text preview
                  </h3>
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-2xl border border-slate-800 bg-slate-900/70 p-3 text-xs text-slate-300">
                    {pageState.visibleText || 'No visible text captured.'}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="mt-3 rounded-2xl border border-dashed border-slate-700 bg-slate-900/50 p-4 text-sm text-slate-400">
                No snapshot yet. Use the current tab and click “Inspect page.”
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
