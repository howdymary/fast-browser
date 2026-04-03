import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';

import type {
  BackgroundResponse,
  RunEventServerMessage,
  RunFinishServerMessage,
  RunPortClientMessage,
  RunPortServerMessage,
} from '../shared/messages';
import {
  DEFAULT_PROVIDER_SETTINGS,
  getProviderEndpoint,
  fetchInstalledModelOptions,
  getSuggestedModelOptions,
  validateProviderSettings,
  type ProviderModelOption,
} from '../shared/settings';
import type { ProviderSettings, RunPhase } from '../shared/types';
import { ActionFeed } from './components/ActionFeed';
import { useAgentStore } from './stores/agent-store';
import { useSettingsStore } from './stores/settings-store';

const MAX_STEPS_DEFAULT = 6;
const TASK_SUGGESTIONS = [
  'Summarize this page in 3 bullets.',
  'Find the pricing details on this page.',
  'Click the login button.',
  'Find the primary search box and focus it.',
];

interface FormErrors {
  task?: string;
  model?: string;
  endpoint?: string;
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
    errors.task = 'Enter a short instruction before running the agent.';
  }

  if (!/^[a-zA-Z0-9._:/-]{1,128}$/.test(settings.model.trim())) {
    errors.model = 'Use only letters, numbers, . _ : / and - in the model name.';
  }

  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 20) {
    errors.maxSteps = 'Choose a whole number between 1 and 20.';
  }

  if (!settings.baseUrl?.trim()) {
    errors.endpoint = 'Set an Ollama endpoint before running.';
  } else if (settings.baseUrl?.trim()) {
    try {
      new URL(settings.baseUrl);
    } catch {
      errors.endpoint = 'Base URL must be a valid URL.';
    }
  }

  return errors;
}

function statusLabelForPhase(phase: RunPhase | null): string {
  switch (phase) {
    case 'observe':
      return 'Reading page';
    case 'plan':
      return 'Thinking';
    case 'act':
      return 'Taking action';
    case 'verify':
      return 'Checking result';
    case 'awaiting-human':
      return 'Waiting for you';
    case 'error':
      return 'Needs attention';
    default:
      return 'Ready';
  }
}

function providerHint(): string {
  return 'Fast Browser runs against your local Ollama server. Pick a detected model or type any local model ID.';
}

function providerSummary(settings: ProviderSettings): string {
  return `Local Ollama · ${settings.model}`;
}

function installedModelStatusLabel(
  installedModels: ProviderModelOption[],
  loading: boolean,
): string {
  if (loading) {
    return 'Checking local models…';
  }
  if (installedModels.length === 0) {
    return 'No local models detected';
  }
  return `${installedModels.length} local model${installedModels.length === 1 ? '' : 's'} detected`;
}

function formatSuggestedInstallCommand(model: string): string {
  return `ollama pull ${model}`;
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
      label: 'Open a normal website tab before asking Fast Browser to inspect or automate it.',
    };
  }

  const origin = new URL(url).origin;
  const pattern = toOriginPattern(url);
  const granted = await chrome.permissions.contains({ origins: [pattern] });

  return {
    status: granted ? 'granted' : 'not-granted',
    origin,
    label: granted
      ? `Fast Browser can keep working on ${origin} without asking again.`
      : `Fast Browser needs access to ${origin} to read and interact with the page.`,
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

  const [maxSteps, setMaxSteps] = useState(MAX_STEPS_DEFAULT);
  const [validationAttempted, setValidationAttempted] = useState(false);
  const [siteAccess, setSiteAccess] = useState<SiteAccessState>({
    status: 'unknown',
    label: 'Checking site access…',
  });
  const [showSetup, setShowSetup] = useState(false);
  const [showAdvancedSetup, setShowAdvancedSetup] = useState(false);
  const [showAdvancedControls, setShowAdvancedControls] = useState(false);
  const [installedModels, setInstalledModels] = useState<ProviderModelOption[]>([]);
  const [installedModelsLoading, setInstalledModelsLoading] = useState(false);
  const [installedModelsError, setInstalledModelsError] = useState<string | null>(null);
  const [modelNotice, setModelNotice] = useState<string | null>(null);

  const runnerPortRef = useRef<chrome.runtime.Port | null>(null);
  const currentRunIdRef = useRef<string | null>(null);
  const lastSeqRef = useRef(0);
  const phaseRef = useRef<RunPhase | null>(null);
  const disconnectSuppressedRef = useRef(false);
  const initialModelSelectionRef = useRef(false);

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
        label: 'Fast Browser could not determine the current site access state.',
      });
    });
  }, []);

  useEffect(() => {
    if (!settings.model.trim()) {
      setShowSetup(true);
    }
  }, [settings]);

  async function refreshInstalledModels(): Promise<void> {
    setInstalledModelsLoading(true);
    setInstalledModelsError(null);
    setModelNotice(null);

    try {
      const models = await fetchInstalledModelOptions();
      setInstalledModels(models);
      if (models.length === 0) {
        setInstalledModelsError('No local Ollama models were found yet. Run "ollama pull llama3.2:3b" to install a good default.');
      }
    } catch (error) {
      setInstalledModels([]);
      setInstalledModelsError(
        error instanceof Error
          ? `${error.message} Start Ollama with "ollama serve" if it is not already running.`
          : 'Could not reach the local Ollama server.',
      );
    } finally {
      setInstalledModelsLoading(false);
    }
  }

  useEffect(() => {
    if (!loaded) {
      return;
    }
    void refreshInstalledModels();
  }, [loaded]);

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
  const modelOptions = useMemo(() => installedModels, [installedModels]);
  const suggestedModels = useMemo(() => getSuggestedModelOptions(), []);
  const selectedModelOption = useMemo(
    () => modelOptions.find((option) => option.value === settings.model) ?? null,
    [modelOptions, settings.model],
  );
  const suggestedModelNames = useMemo(
    () => suggestedModels.map((option) => option.value).join(', '),
    [suggestedModels],
  );
  const currentModelInstalled = useMemo(
    () => modelOptions.some((option) => option.value === settings.model.trim()),
    [modelOptions, settings.model],
  );
  const preferredInstalledModel = useMemo(() => {
    const installedNames = new Set(modelOptions.map((option) => option.value));
    if (installedNames.has(DEFAULT_PROVIDER_SETTINGS.model)) {
      return DEFAULT_PROVIDER_SETTINGS.model;
    }

    for (const option of suggestedModels) {
      if (installedNames.has(option.value)) {
        return option.value;
      }
    }

    return modelOptions[0]?.value ?? null;
  }, [modelOptions, suggestedModels]);
  const providerValidationError = useMemo(
    () => validateProviderSettings(settings),
    [settings],
  );
  const formErrors = useMemo<FormErrors>(
    () => (validationAttempted ? validateRunForm(task, maxSteps, settings) : {}),
    [maxSteps, settings, task, validationAttempted],
  );
  const hasValidationErrors = Object.keys(formErrors).length > 0;
  const showSetupCard = showSetup || Boolean(providerValidationError);
  const showSiteAccessBanner = siteAccess.status === 'unsupported'
    || (siteAccess.status === 'not-granted' && (validationAttempted || Boolean(error)));

  useEffect(() => {
    if (
      initialModelSelectionRef.current
      || installedModelsLoading
      || modelOptions.length === 0
    ) {
      return;
    }

    initialModelSelectionRef.current = true;

    if (!currentModelInstalled) {
      const fallbackModel = preferredInstalledModel;
      if (!fallbackModel) {
        return;
      }

      const previousModel = settings.model.trim();
      updateSettings({ model: fallbackModel });

      if (previousModel && previousModel !== fallbackModel) {
        setModelNotice(
          `"${previousModel}" is not installed locally. Fast Browser switched to "${fallbackModel}". Run "${formatSuggestedInstallCommand(previousModel)}" if you want to use it.`,
        );
      }
    }
  }, [currentModelInstalled, installedModelsLoading, preferredInstalledModel, settings.model, updateSettings]);

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

    setError(finish.error ?? null);

    if (phaseRef.current === 'awaiting-human') {
      setPhase('awaiting-human');
    } else if (finish.ok || (finish.error ?? '').match(/cancelled/i)) {
      setPhase(null);
    } else {
      setPhase('error');
    }

    cleanupRunnerPort();
  }

  async function handleInspectPage(): Promise<void> {
    setPhase('observe');
    setError(null);
    setSiteAccess(await getCurrentSiteAccess());

    const response = await chrome.runtime.sendMessage({
      type: 'FAST_BROWSER_INSPECT_PAGE',
      task: task.trim() || undefined,
    }) as BackgroundResponse;

    if (!response.ok || !response.pageState) {
      setPhase('error');
      setError(response.error ?? 'Fast Browser could not inspect this page.');
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

    if (validationError) {
      setShowSetup(true);
      setError(validationError);
      return;
    }

    if (Object.keys(nextFormErrors).length > 0) {
      setError(nextFormErrors.task ?? nextFormErrors.maxSteps ?? 'Fix the highlighted fields and try again.');
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
        setError('Connection lost. Reopen the panel and try the run again.');
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
        label: `Fast Browser can keep working on ${origin} without asking again.`,
      });
      return;
    }

    setSiteAccess({
      status: 'not-granted',
      origin,
      label: `Site access for ${origin} was not granted. You can still use temporary active-tab access after opening the panel from the toolbar.`,
    });
  }

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

  function handleModelSelection(value: string): void {
    setModelNotice(null);
    updateSettings({ model: value });
  }

  async function handleSaveSetup(): Promise<void> {
    setValidationAttempted(true);
    const validationError = validateProviderSettings(settings);
    if (validationError) {
      setError(validationError);
      return;
    }

    await saveSettings();
    setError(null);
    setShowSetup(false);
  }

  function handleClearState(): void {
    setPageState(null);
    setError(null);
    resetFeed();
    setPhase(null);
    setValidationAttempted(false);
    cleanupRunnerPort();
  }

  const currentEndpoint = getProviderEndpoint(settings);

  return (
    <main className="min-h-screen px-4 py-5 text-stone-50">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <section className="rounded-[30px] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(251,146,60,0.14),transparent_35%),linear-gradient(180deg,rgba(17,24,39,0.98),rgba(11,15,25,0.98))] p-5 shadow-[0_24px_60px_rgba(2,6,23,0.45)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-xl">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-orange-300/25 bg-orange-400/10 text-sm font-semibold text-orange-100">
                  FB
                </div>
                <div className="space-y-1">
                  <p className="text-[11px] uppercase tracking-[0.28em] text-orange-200/80">Fast Browser</p>
                  <h1 className="text-2xl font-semibold tracking-tight text-white">
                    Ask me to use the current page
                  </h1>
                </div>
              </div>
              <p className="mt-3 max-w-lg text-sm leading-6 text-slate-300">
                Tell Fast Browser what you want done on this tab. It reads the page, chooses the next action,
                and checks the result as it goes.
              </p>
            </div>

            <div className="flex flex-col items-start gap-2 sm:items-end">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 backdrop-blur">
                {phase === 'plan' ? (
                  <span
                    className="fast-browser-spinner h-2.5 w-2.5 rounded-full border border-orange-200 border-t-transparent"
                    aria-hidden="true"
                  />
                ) : (
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" aria-hidden="true" />
                )}
                {statusLabel}
              </div>
              <button
                type="button"
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-white/20 hover:bg-white/10"
                onClick={() => setShowSetup((current) => !current)}
              >
                {showSetupCard ? 'Hide local setup' : 'Local setup'}
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white/6 px-3 py-1 text-xs text-slate-200">
              {providerSummary(settings)}
            </span>
            <span className="rounded-full bg-white/6 px-3 py-1 text-xs text-slate-400">
              {siteAccess.status === 'granted' ? 'Site access ready' : 'Uses page access when available'}
            </span>
          </div>

          {showSetupCard ? (
            <div className="mt-4 rounded-[26px] border border-white/10 bg-black/20 p-4 backdrop-blur">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-white">Local model setup</h2>
                  <p className="mt-1 max-w-lg text-sm text-slate-300">{providerHint()}</p>
                </div>
                <button
                  type="button"
                  className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-slate-300 transition hover:border-white/20 hover:bg-white/5"
                  onClick={() => setShowSetup(false)}
                  disabled={Boolean(providerValidationError)}
                >
                  Hide
                </button>
              </div>

              <div className="mt-4 rounded-2xl border border-emerald-500/15 bg-emerald-500/8 px-4 py-3 text-sm text-emerald-100">
                <div className="font-medium">Local-only mode</div>
                <div className="mt-1 text-emerald-100/80">
                  Fast Browser now uses only your local Ollama server. No external API key is required.
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <label className="block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400" htmlFor="model-select">
                      Installed models
                    </label>
                    <button
                      type="button"
                      className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-slate-300 transition hover:border-white/20 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => { void refreshInstalledModels(); }}
                      disabled={runInFlight || installedModelsLoading}
                    >
                      {installedModelsLoading ? 'Refreshing…' : 'Refresh models'}
                    </button>
                  </div>
                  {modelOptions.length > 0 ? (
                    <select
                      id="model-select"
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-3 py-3 text-sm text-slate-50 outline-none focus:border-orange-300/60"
                      value={currentModelInstalled ? settings.model : (preferredInstalledModel ?? modelOptions[0]?.value)}
                      onChange={(event) => handleModelSelection(event.target.value)}
                      disabled={runInFlight}
                    >
                      {modelOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="mt-2 rounded-2xl border border-dashed border-white/10 bg-slate-950/60 px-3 py-3 text-sm text-slate-400">
                      {installedModelsLoading ? 'Checking local Ollama models…' : 'No local Ollama models detected yet.'}
                    </div>
                  )}
                  <p className="mt-2 text-xs text-slate-500">
                    {selectedModelOption?.helper ?? 'Type a local model ID below if you want to use a model that is not in the detected list yet.'}
                  </p>
                  <p className="mt-2 text-xs text-slate-500">
                    {installedModelStatusLabel(modelOptions, installedModelsLoading)}
                  </p>
                  {installedModelsError ? (
                    <p className="mt-2 text-xs text-amber-200">{installedModelsError}</p>
                  ) : null}
                  {modelNotice ? (
                    <p className="mt-2 text-xs text-amber-200">{modelNotice}</p>
                  ) : null}
                  <label className="mt-3 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500" htmlFor="model-input">
                    Model ID
                  </label>
                  <input
                    id="model-input"
                    className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-3 py-3 text-sm text-slate-50 outline-none focus:border-orange-300/60"
                    value={settings.model}
                    onChange={(event) => {
                      setModelNotice(null);
                      updateSettings({ model: event.target.value });
                    }}
                    placeholder="Example: llama3.2:3b"
                    disabled={runInFlight}
                  />
                  {!currentModelInstalled && settings.model.trim() && modelOptions.length > 0 ? (
                    <p className="mt-2 text-xs text-amber-200">
                      "{settings.model}" is not detected locally. Install it with <code className="rounded bg-white/5 px-1 py-0.5 text-[11px]">{formatSuggestedInstallCommand(settings.model)}</code> or switch to one of the detected models above.
                    </p>
                  ) : null}
                  {validationAttempted && formErrors.model ? (
                    <p className="mt-2 text-xs text-rose-300">{formErrors.model}</p>
                  ) : null}
                </div>
                <div className="rounded-2xl border border-white/8 bg-slate-950/70 p-4 text-sm text-slate-200">
                  <div className="font-medium text-white">Quick local setup</div>
                  <ol className="mt-2 list-decimal space-y-2 pl-4 text-sm text-slate-300">
                    <li>Start Ollama with <code className="rounded bg-white/5 px-1 py-0.5 text-xs">ollama serve</code>.</li>
                    <li>Install a model if needed, for example <code className="rounded bg-white/5 px-1 py-0.5 text-xs">ollama pull llama3.2:3b</code>.</li>
                    <li>Click refresh above if you just installed a model, then run a prompt on the current page.</li>
                  </ol>
                  <div className="mt-4 rounded-2xl border border-white/8 bg-black/20 px-3 py-3 text-xs text-slate-400">
                    Recommended free models to install next: {suggestedModelNames}.
                  </div>
                </div>
              </div>

              <button
                type="button"
                className="mt-4 text-sm font-medium text-orange-200 transition hover:text-orange-100"
                onClick={() => setShowAdvancedSetup((current) => !current)}
              >
                {showAdvancedSetup ? 'Hide advanced model options' : 'Show advanced model options'}
              </button>

              {showAdvancedSetup ? (
                <div className="mt-3 rounded-2xl border border-white/8 bg-slate-950/70 p-3">
                  <label className="block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400" htmlFor="base-url-input">
                    Endpoint
                  </label>
                  <input
                    id="base-url-input"
                    className="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-slate-50 outline-none focus:border-orange-300/60"
                    value={settings.baseUrl ?? ''}
                    onChange={(event) => updateSettings({ baseUrl: event.target.value })}
                    placeholder={currentEndpoint}
                    disabled={runInFlight}
                  />
                  <p className="mt-2 text-xs text-slate-500">
                    Leave this at the default unless your Ollama server is running somewhere else.
                  </p>
                  {validationAttempted && formErrors.endpoint ? (
                    <p className="mt-2 text-xs text-rose-300">{formErrors.endpoint}</p>
                  ) : null}
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  className="rounded-full bg-orange-300 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-orange-200"
                  onClick={() => { void handleSaveSetup(); }}
                  disabled={runInFlight}
                >
                  Save local setup
                </button>
                <span className="self-center text-xs text-slate-500">
                  Current endpoint: {currentEndpoint}
                </span>
              </div>
            </div>
          ) : null}

          {showSiteAccessBanner ? (
            <div className="mt-4 rounded-[24px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-medium text-white">
                    {siteAccess.status === 'unsupported'
                      ? 'Fast Browser cannot run on this tab'
                      : 'Fast Browser needs access to this site'}
                  </div>
                  <p className="mt-1 max-w-xl text-sm text-slate-300">{siteAccess.label}</p>
                </div>
                {siteAccess.status !== 'unsupported' ? (
                  <button
                    type="button"
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-100 transition hover:border-white/20 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => { void handleGrantSiteAccess(); }}
                    disabled={runInFlight || siteAccess.status === 'granted'}
                  >
                    {siteAccess.status === 'granted' ? 'Allowed' : 'Allow on this site'}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="mt-5 rounded-[26px] border border-white/10 bg-black/20 p-4">
            <label className="block text-xs font-semibold uppercase tracking-[0.25em] text-slate-400" htmlFor="task-input">
              What should Fast Browser do?
            </label>
            <textarea
              id="task-input"
              className="mt-3 min-h-32 w-full rounded-[22px] border border-white/10 bg-slate-950/85 px-4 py-4 text-sm leading-6 text-slate-50 outline-none placeholder:text-slate-500 focus:border-orange-300/60"
              placeholder="Summarize this page, find the pricing, click the login button, or focus the main search box."
              value={task}
              onChange={(event) => setTask(event.target.value)}
            />
            {validationAttempted && formErrors.task ? (
              <p className="mt-2 text-xs text-rose-300">{formErrors.task}</p>
            ) : null}

            <div className="mt-3 flex flex-wrap gap-2">
              {TASK_SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 transition hover:border-white/20 hover:bg-white/10"
                  onClick={() => setTask(suggestion)}
                  disabled={runInFlight}
                >
                  {suggestion}
                </button>
              ))}
            </div>

            {phase === 'plan' ? (
              <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-orange-400/10 px-3 py-1.5 text-sm text-orange-100">
                <span
                  className="fast-browser-spinner h-3 w-3 rounded-full border border-orange-200 border-t-transparent"
                  aria-hidden="true"
                />
                Thinking about the next step…
              </div>
            ) : null}

            {error ? (
              <div className="mt-4 rounded-2xl border border-rose-700/60 bg-rose-950/40 px-3 py-2 text-sm text-rose-100">
                {error}
              </div>
            ) : null}

            {validationAttempted && hasValidationErrors && !error ? (
              <div className="mt-4 rounded-2xl border border-amber-700/60 bg-amber-950/30 px-3 py-2 text-sm text-amber-100">
                Finish setup and try again.
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="rounded-full bg-orange-300 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-orange-200 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                onClick={() => { void handleRunAgent(); }}
                disabled={runInFlight}
              >
                {providerValidationError ? 'Save setup and run' : 'Run on this page'}
              </button>
              <button
                type="button"
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-100 transition hover:border-white/20 hover:bg-white/10 disabled:cursor-not-allowed disabled:border-white/5 disabled:text-slate-500"
                onClick={handleCancelRun}
                disabled={!runInFlight}
              >
                Stop
              </button>
              <button
                type="button"
                className="text-sm font-medium text-slate-400 transition hover:text-slate-200"
                onClick={() => setShowAdvancedControls((current) => !current)}
              >
                {showAdvancedControls ? 'Hide advanced controls' : 'Show advanced controls'}
              </button>
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.92),rgba(11,15,25,0.92))] p-4 shadow-[0_18px_40px_rgba(2,6,23,0.28)]">
            <div className="mb-3">
              <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-200">Transcript</h2>
              <p className="mt-1 text-xs text-slate-500">
                Fast Browser narrates what it sees and does as the run progresses.
              </p>
            </div>
            <ActionFeed entries={feed} />
          </div>

          <div className="space-y-4">
            <section className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.92),rgba(11,15,25,0.92))] p-4 shadow-[0_18px_40px_rgba(2,6,23,0.28)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-200">Current page</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Refresh page context manually only if the page changed outside the agent run.
                  </p>
                </div>
                <button
                  type="button"
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-100 transition hover:border-white/20 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => { void handleInspectPage(); }}
                  disabled={runInFlight}
                >
                  Refresh page context
                </button>
              </div>

              {pageState ? (
                <div className="mt-4 space-y-4 text-sm text-slate-200">
                  <div className="rounded-2xl border border-white/8 bg-white/5 p-3">
                    <div className="font-medium text-white">{pageState.title || '(untitled page)'}</div>
                    <div className="mt-1 break-all text-xs text-slate-400">{pageState.url}</div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-300">
                      <div>Elements: {pageState.meta.elementCount}</div>
                      <div>Forms: {pageState.meta.hasForm ? 'yes' : 'no'}</div>
                      <div>Dialogs: {pageState.meta.hasDialog ? 'yes' : 'no'}</div>
                      <div>Scroll: {pageState.meta.scrollPercent}%</div>
                    </div>
                  </div>

                  <details className="rounded-2xl border border-white/8 bg-white/5 p-3" open>
                    <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.2em] text-slate-300">
                      Interactive elements
                    </summary>
                    <div className="mt-3 max-h-72 space-y-2 overflow-auto pr-1">
                      {pageState.elements.map((element) => (
                        <div
                          key={element.ref}
                          className="rounded-2xl border border-white/8 bg-black/20 px-3 py-2"
                        >
                          <div className="text-xs text-orange-200">{element.ref}</div>
                          <div className="mt-1 font-medium text-white">{element.name}</div>
                          <div className="mt-1 text-xs text-slate-400">
                            {element.tag} · {element.role}
                            {element.type ? ` · ${element.type}` : ''}
                            {element.state?.length ? ` · ${element.state.join(', ')}` : ''}
                            {element.inViewport ? ' · in view' : ' · off screen'}
                          </div>
                          {element.context ? (
                            <div className="mt-1 text-xs text-slate-500">Context: {element.context}</div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </details>

                  <details className="rounded-2xl border border-white/8 bg-white/5 p-3">
                    <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.2em] text-slate-300">
                      Visible text preview
                    </summary>
                    <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-2xl border border-white/8 bg-black/20 p-3 text-xs text-slate-300">
                      {pageState.visibleText || 'No visible text captured.'}
                    </pre>
                  </details>
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-dashed border-white/10 bg-white/5 p-4 text-sm text-slate-400">
                  No page context yet. Run a task and Fast Browser will inspect the page automatically.
                </div>
              )}
            </section>

            {showAdvancedControls ? (
              <section className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.92),rgba(11,15,25,0.92))] p-4 shadow-[0_18px_40px_rgba(2,6,23,0.28)]">
                <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-200">Advanced controls</h2>
                <div className="mt-4 space-y-4">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400" htmlFor="max-steps-input">
                      Max steps
                    </label>
                    <input
                      id="max-steps-input"
                      type="number"
                      min={1}
                      max={20}
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-3 py-3 text-sm text-slate-50 outline-none focus:border-orange-300/60"
                      value={Number.isFinite(maxSteps) ? maxSteps : ''}
                      onChange={(event) => setMaxSteps(Number.parseInt(event.target.value, 10))}
                      disabled={runInFlight}
                    />
                    <p className="mt-2 text-xs text-slate-500">Most tasks work well with 4 to 8 steps.</p>
                    {validationAttempted && formErrors.maxSteps ? (
                      <p className="mt-2 text-xs text-rose-300">{formErrors.maxSteps}</p>
                    ) : null}
                  </div>

                  <div className="rounded-2xl border border-white/8 bg-white/5 px-4 py-3 text-sm text-slate-300">
                    <div className="font-medium text-white">Current endpoint</div>
                    <div className="mt-1 break-all text-xs text-slate-400">{currentEndpoint}</div>
                  </div>

                  <button
                    type="button"
                    className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-100 transition hover:border-white/20 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={handleClearState}
                    disabled={runInFlight}
                  >
                    Clear transcript and context
                  </button>
                </div>
              </section>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
