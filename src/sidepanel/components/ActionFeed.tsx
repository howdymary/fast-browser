import type { ReactElement } from 'react';

import type { ActionFeedEntry } from '../../shared/types';

const toneClasses: Record<ActionFeedEntry['kind'], string> = {
  info: 'border-slate-700 bg-slate-900/70 text-slate-200',
  success: 'border-emerald-700/70 bg-emerald-950/40 text-emerald-200',
  warning: 'border-amber-700/70 bg-amber-950/40 text-amber-200',
  error: 'border-rose-700/70 bg-rose-950/40 text-rose-200',
};

const MAX_VISIBLE_ENTRIES = 200;

interface ActionFeedProps {
  entries: ActionFeedEntry[];
}

export function ActionFeed({ entries }: ActionFeedProps): ReactElement {
  const visibleEntries = entries.slice(-MAX_VISIBLE_ENTRIES);

  if (visibleEntries.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/40 p-4 text-sm text-slate-400">
        No agent actions yet. Start with “Inspect page” to prove the extension wiring works.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {visibleEntries.map((entry) => (
        <div
          key={entry.id}
          className={`rounded-2xl border px-3 py-2 text-sm shadow-sm ${toneClasses[entry.kind]}`}
        >
          <div className="font-medium">{entry.message}</div>
          <div className="mt-1 text-xs opacity-70">
            {new Date(entry.timestamp).toLocaleTimeString()}
          </div>
        </div>
      ))}
    </div>
  );
}
