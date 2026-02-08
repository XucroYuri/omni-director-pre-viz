'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

type Episode = {
  id: string;
  title: string;
  script: string;
  context: string;
  updated_at: string;
};

async function expectOk<T>(response: Response, label: string): Promise<T> {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${label} failed (${response.status}): ${text}`);
  }
  return response.json() as Promise<T>;
}

export default function EpisodesPage() {
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [title, setTitle] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canCreate = useMemo(() => title.trim().length > 0 && !pending, [title, pending]);

  const load = useCallback(async () => {
    const data = await expectOk<{ episodes: Episode[] }>(await fetch('/api/episodes', { cache: 'no-store' }), 'list episodes');
    setEpisodes(data.episodes || []);
  }, []);

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [load]);

  const handleCreate = async () => {
    if (!canCreate) return;
    setError(null);
    setPending(true);
    try {
      await expectOk(await fetch('/api/episodes', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-dev-user': 'episodes-ui',
          'x-dev-role': 'editor',
        },
        body: JSON.stringify({ title: title.trim() }),
      }), 'create episode');
      setTitle('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="min-h-screen p-6 sm:p-10">
      <div className="mx-auto max-w-5xl space-y-6 rounded-2xl border border-slate-300/70 bg-white/85 p-6 shadow-xl shadow-slate-300/30 backdrop-blur sm:p-8">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Episodes</h1>
            <p className="text-sm text-slate-600">Create an episode, paste a script, break it down into shots, generate 3x3 matrices, and export.</p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/"
              className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50"
            >
              Home
            </Link>
            <Link
              href="/ops/queue"
              className="inline-flex items-center rounded-lg border border-indigo-500 bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
            >
              Queue Ops
            </Link>
          </div>
        </header>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-sm font-medium text-slate-900">New episode</div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Episode title"
              className="w-full flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500"
            />
            <button
              disabled={!canCreate}
              onClick={() => void handleCreate()}
              className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {pending ? 'Creating…' : 'Create'}
            </button>
          </div>
          {error ? <div className="mt-3 text-sm text-red-700">{error}</div> : null}
        </section>

        <section className="space-y-3">
          <div className="text-sm font-semibold text-slate-900">Recent</div>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Title</th>
                  <th className="hidden px-3 py-2 sm:table-cell">Updated</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {episodes.length === 0 ? (
                  <tr className="border-t border-slate-100">
                    <td className="px-3 py-3 text-slate-600" colSpan={3}>
                      No episodes yet.
                    </td>
                  </tr>
                ) : (
                  episodes.map((ep) => (
                    <tr key={ep.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-medium text-slate-900">
                        <div className="truncate">{ep.title}</div>
                        <div className="mt-1 text-xs text-slate-500">{ep.id}</div>
                      </td>
                      <td className="hidden px-3 py-2 text-slate-600 sm:table-cell">{new Date(ep.updated_at).toLocaleString()}</td>
                      <td className="px-3 py-2">
                        <Link
                          className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50"
                          href={`/episodes/${ep.id}`}
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
