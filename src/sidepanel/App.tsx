import { useEffect, useMemo, type ReactElement } from 'react';

import type { BackgroundResponse } from '../shared/messages';
import { ActionFeed } from './components/ActionFeed';
import { useAgentStore } from './stores/agent-store';
import { useSettingsStore } from './stores/settings-store';

export function App(): ReactElement {
  const {
    task,
    status,
    pageState,
    feed,
    error,
    setTask,
    setStatus,
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

  useEffect(() => {
    if (!loaded) {
      void loadSettings();
    }
  }, [loaded, loadSettings]);

  const statusLabel = useMemo(() => {
    switch (status) {
      case 'thinking':
        return 'Reading the current page';
      case 'acting':
        return 'Executing an action';
      case 'asking':
        return 'Waiting for confirmation';
      case 'error':
        return 'Needs attention';
      default:
        return 'Ready';
    }
  }, [status]);

  async function handleInspectPage(): Promise<void> {
    setStatus('thinking');
    setError(null);
    resetFeed();

    const response = await chrome.runtime.sendMessage({
      type: 'FAST_BROWSER_INSPECT_PAGE',
      task: task.trim() || undefined,
    }) as BackgroundResponse;

    if (!response.ok || !response.pageState) {
      setStatus('error');
      setError(response.error ?? 'Unknown extension error.');
      appendFeed(response.feed ?? []);
      return;
    }

    setPageState(response.pageState);
    appendFeed(response.feed ?? []);
    setStatus('idle');
  }

  async function handleRunAgent(): Promise<void> {
    setStatus('thinking');
    setError(null);
    resetFeed();
    setPageState(null);

    await saveSettings();

    const response = await chrome.runtime.sendMessage({
      type: 'FAST_BROWSER_RUN_TASK',
      task: task.trim(),
    }) as BackgroundResponse;

    appendFeed(response.feed ?? []);

    if (!response.ok) {
      setStatus('error');
      setError(response.error ?? 'The browser agent failed.');
      if (response.pageState) {
        setPageState(response.pageState);
      }
      return;
    }

    if (response.pageState) {
      setPageState(response.pageState);
    }

    const hasWarning = (response.feed ?? []).some((entry) => entry.kind === 'warning');
    setStatus(hasWarning ? 'asking' : 'idle');
    if (response.finalMessage) {
      setError(null);
    }
  }

  return (
    <main className="min-h-screen px-4 py-5 text-slate-50">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <section className="rounded-3xl border border-slate-800 bg-slate-950/70 p-4 shadow-2xl shadow-slate-950/40">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-sky-300">Fast Browser</p>
              <h1 className="mt-1 text-xl font-semibold">First real action loop</h1>
            </div>
            <div className="rounded-full border border-slate-700 bg-slate-900/70 px-3 py-1 text-xs text-slate-300">
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

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              className="rounded-full bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-sky-400"
              onClick={() => { void handleInspectPage(); }}
            >
              Inspect page
            </button>
            <button
              type="button"
              className="rounded-full bg-emerald-400 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
              onClick={() => { void handleRunAgent(); }}
              disabled={!task.trim()}
            >
              Run agent
            </button>
            <button
              type="button"
              className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500 hover:bg-slate-900"
              onClick={() => {
                setPageState(null);
                setError(null);
                resetFeed();
                setStatus('idle');
              }}
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
              />
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
              />
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
              />
            </div>
          </div>

          {error ? (
            <div className="mt-4 rounded-2xl border border-rose-700/70 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
              {error}
            </div>
          ) : null}
        </section>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div className="rounded-3xl border border-slate-800 bg-slate-950/60 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-300">Action feed</h2>
              <span className="text-xs text-slate-500">Current focus: inspect + click/type/scroll/wait/navigate</span>
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
