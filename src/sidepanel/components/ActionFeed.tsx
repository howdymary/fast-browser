import { useEffect, useRef, type ReactElement } from 'react';

import type { ActionFeedEntry } from '../../shared/types';

const toneClasses: Record<ActionFeedEntry['kind'], string> = {
  info: 'border-[#eadfce] bg-[#faf6ef] text-[#5b4d40]',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  error: 'border-rose-200 bg-rose-50 text-rose-700',
};

const MAX_VISIBLE_ENTRIES = 200;

interface ActionFeedProps {
  entries: ActionFeedEntry[];
}

function renderEntry(entry: ActionFeedEntry): ReactElement {
  if (entry.kind === 'info' || entry.kind === 'success') {
    return (
      <div key={entry.id} className="flex gap-3 rounded-3xl bg-white/5 px-4 py-3 text-sm text-slate-100">
        <div
          className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
            entry.kind === 'success' ? 'bg-emerald-300' : 'bg-orange-300/90'
          }`}
        />
        <div className="min-w-0 flex-1">
          <div className="font-medium leading-6">{entry.message}</div>
          <div className="mt-1 text-xs text-slate-500">
            {new Date(entry.timestamp).toLocaleTimeString()}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      key={entry.id}
      className={`rounded-3xl border px-4 py-3 text-sm shadow-[0_10px_30px_rgba(70,44,20,0.04)] ${toneClasses[entry.kind]}`}
    >
      <div className="font-medium leading-6">{entry.message}</div>
      <div className="mt-1 text-xs opacity-60">
        {new Date(entry.timestamp).toLocaleTimeString()}
      </div>
    </div>
  );
}

export function ActionFeed({ entries }: ActionFeedProps): ReactElement {
  const visibleEntries = entries.slice(-MAX_VISIBLE_ENTRIES);
  const latestEntry = visibleEntries.at(-1) ?? null;
  const historyEntries = latestEntry ? visibleEntries.slice(0, -1) : [];
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [historyEntries.length]);

  if (visibleEntries.length === 0) {
    return (
      <div className="h-[28rem] overflow-y-auto rounded-3xl border border-dashed border-[#dccab0] bg-[#fbf7f0] p-5 text-sm leading-6 text-[#6d6255]">
        No run activity yet. Enter a short prompt and run it. Fast Browser will inspect the current tab automatically before it acts.
      </div>
    );
  }

  return (
    <div className="h-[28rem] rounded-3xl border border-white/8 bg-black/10 p-3">
      {latestEntry ? (
        <div className="rounded-3xl border border-orange-300/20 bg-orange-300/10 px-4 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-orange-200/75">
            Latest update
          </div>
          <div className="mt-3">{renderEntry(latestEntry)}</div>
        </div>
      ) : null}

      <div className="mt-4">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
          Earlier steps
        </div>
        <div className="h-[18rem] overflow-y-auto scroll-smooth pr-1">
          {historyEntries.length > 0 ? (
            <div className="space-y-3">
              {historyEntries.map((entry) => renderEntry(entry))}
              <div ref={bottomRef} />
            </div>
          ) : (
            <div className="rounded-3xl border border-dashed border-white/8 bg-white/5 px-4 py-4 text-sm text-slate-400">
              Older steps will stack here while the latest update stays pinned above.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
