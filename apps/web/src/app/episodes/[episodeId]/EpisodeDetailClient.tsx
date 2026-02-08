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

type Shot = {
  id: string;
  order_index: number;
  original_text: string;
  visual_translation: string;
  status: string;
  matrix_image_key: string | null;
  split_image_keys_json: unknown[];
  updated_at: string;
};

async function expectOk<T>(response: Response, label: string): Promise<T> {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${label} failed (${response.status}): ${text}`);
  }
  return response.json() as Promise<T>;
}

export default function EpisodeDetailClient({ episodeId }: { episodeId: string }) {
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [scriptDraft, setScriptDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [ep, shotList] = await Promise.all([
      expectOk<{ episode: Episode }>(await fetch(`/api/episodes/${episodeId}`, { cache: 'no-store' }), 'get episode'),
      expectOk<{ shots: Shot[] }>(await fetch(`/api/shots?episodeId=${encodeURIComponent(episodeId)}`, { cache: 'no-store' }), 'list shots'),
    ]);
    setEpisode(ep.episode);
    setScriptDraft(ep.episode.script || '');
    setShots(shotList.shots || []);
  }, [episodeId]);

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [load]);

  const canSave = useMemo(() => !pending && episode !== null, [pending, episode]);

  const saveScript = async () => {
    if (!canSave) return;
    setError(null);
    setPending(true);
    try {
      await expectOk(
        await fetch(`/api/episodes/${episodeId}`, {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({ script: scriptDraft }),
        }),
        'save script',
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  const enqueueBreakdown = async () => {
    setError(null);
    setPending(true);
    try {
      await expectOk(
        await fetch(`/api/episodes/${episodeId}/breakdown`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({}),
        }),
        'enqueue breakdown',
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  const enqueueMatrix = async (shotId: string) => {
    setError(null);
    setPending(true);
    try {
      await expectOk(
        await fetch(`/api/shots/${shotId}/matrix`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({}),
        }),
        'enqueue matrix',
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  const exportZipUrl = useMemo(() => `/api/episodes/${episodeId}/export`, [episodeId]);

  return (
    <main className="min-h-screen p-6 sm:p-10">
      <div className="mx-auto max-w-6xl space-y-6 rounded-2xl border border-slate-300/70 bg-white/85 p-6 shadow-xl shadow-slate-300/30 backdrop-blur sm:p-8">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Episode</div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{episode?.title || episodeId}</h1>
            <div className="text-xs text-slate-500">{episodeId}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/episodes"
              className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50"
            >
              Back
            </Link>
            <Link
              href="/ops/queue"
              className="inline-flex items-center rounded-lg border border-indigo-500 bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
            >
              Queue Ops
            </Link>
            <a
              href={exportZipUrl}
              className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50"
            >
              Export Zip
            </a>
          </div>
        </header>

        {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-slate-900">Script</div>
                <div className="mt-0.5 text-xs text-slate-500">One line per shot for MVP breakdown.</div>
              </div>
              <div className="flex gap-2">
                <button
                  disabled={pending}
                  onClick={() => void saveScript()}
                  className="inline-flex items-center rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {pending ? 'Saving…' : 'Save'}
                </button>
                <button
                  disabled={pending}
                  onClick={() => void enqueueBreakdown()}
                  className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 disabled:opacity-50"
                >
                  Breakdown → Shots
                </button>
              </div>
            </div>
            <textarea
              value={scriptDraft}
              onChange={(e) => setScriptDraft(e.target.value)}
              className="mt-3 h-64 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500"
              placeholder="EXT. STREET - NIGHT\nA lone figure walks past neon signs…"
            />
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-semibold text-slate-900">Next</div>
            <div className="mt-2 text-sm text-slate-700">
              1) Save script
              <br />
              2) Breakdown (creates shots + enqueues matrix tasks)
              <br />
              3) Run worker: <code className="rounded bg-slate-200 px-1 py-0.5">npm run phase9:web:worker</code>
              <br />
              4) Export zip once matrices are generated
            </div>
            <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600">
              S3/MinIO must be configured in <code className="rounded bg-slate-200 px-1 py-0.5">apps/web/.env.local</code> for matrix images + export.
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <div className="text-sm font-semibold text-slate-900">Shots</div>
            <button
              disabled={pending}
              onClick={() => void load()}
              className="text-xs font-semibold text-indigo-700 hover:text-indigo-800 disabled:opacity-50"
            >
              Refresh
            </button>
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Text</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Matrix</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {shots.length === 0 ? (
                  <tr className="border-t border-slate-100">
                    <td className="px-3 py-3 text-slate-600" colSpan={5}>
                      No shots yet.
                    </td>
                  </tr>
                ) : (
                  shots.map((shot) => (
                    <tr key={shot.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-mono text-xs text-slate-700">{shot.order_index}</td>
                      <td className="px-3 py-2">
                        <div className="line-clamp-2 text-slate-900">{shot.original_text}</div>
                        <div className="mt-1 text-xs text-slate-500">{shot.id}</div>
                      </td>
                      <td className="px-3 py-2 text-xs font-semibold text-slate-700">{shot.status}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-slate-600">
                        {shot.matrix_image_key ? 'mother.png + splits' : '-'}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          disabled={pending}
                          onClick={() => void enqueueMatrix(shot.id)}
                          className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 disabled:opacity-50"
                        >
                          Render Matrix
                        </button>
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
