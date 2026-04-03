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

export function ActionFeed({ entries }: ActionFeedProps): ReactElement {
  const visibleEntries = entries.slice(-MAX_VISIBLE_ENTRIES);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!scrollRef.current) {
      return;
    }
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [visibleEntries]);

  if (visibleEntries.length === 0) {
    return (
      <div
        ref={scrollRef}
        className="h-[28rem] overflow-y-auto rounded-3xl border border-dashed border-[#dccab0] bg-[#fbf7f0] p-5 text-sm leading-6 text-[#6d6255]"
      >
        No run activity yet. Enter a short prompt and run it. Fast Browser will inspect the current tab automatically before it acts.
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="h-[28rem] overflow-y-auto pr-1">
      <div className="space-y-3">
        {visibleEntries.map((entry) => (
          entry.kind === 'info' || entry.kind === 'success' ? (
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
          ) : (
            <div
              key={entry.id}
              className={`rounded-3xl border px-4 py-3 text-sm shadow-[0_10px_30px_rgba(70,44,20,0.04)] ${toneClasses[entry.kind]}`}
            >
              <div className="font-medium leading-6">{entry.message}</div>
              <div className="mt-1 text-xs opacity-60">
                {new Date(entry.timestamp).toLocaleTimeString()}
              </div>
            </div>
          )
        ))}
      </div>
    </div>
  );
}
