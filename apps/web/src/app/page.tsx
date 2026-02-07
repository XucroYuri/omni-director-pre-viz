import Link from 'next/link';

const endpoints = [
  { method: 'GET', path: '/api/health', note: 'Health check + infra env echo' },
  { method: 'GET', path: '/api/episodes', note: 'List episodes' },
  { method: 'POST', path: '/api/episodes', note: 'Create episode' },
  { method: 'GET', path: '/api/shots?episodeId=<id>', note: 'List shots' },
  { method: 'POST', path: '/api/shots', note: 'Create shot' },
  { method: 'GET', path: '/api/assets?episodeId=<id>', note: 'List assets' },
  { method: 'POST', path: '/api/assets', note: 'Create asset' },
  { method: 'GET', path: '/api/tasks?episodeId=<id>', note: 'List tasks (episode/status)' },
  { method: 'POST', path: '/api/tasks', note: 'Create queued task' },
  { method: 'GET', path: '/api/tasks/<taskId>', note: 'Fetch task detail' },
  { method: 'POST', path: '/api/tasks/<taskId>/report', note: 'Worker reports status/progress/error' },
  { method: 'POST', path: '/api/tasks/<taskId>/cancel', note: 'Cancel queued/running task' },
  { method: 'POST', path: '/api/tasks/<taskId>/retry', note: 'Retry failed/cancelled task' },
  { method: 'GET', path: '/api/tasks/ops', note: 'Ops snapshot: queue/kind/failed/dead-letter' },
];

export default function HomePage() {
  return (
    <main className="min-h-screen p-8">
      <div className="mx-auto max-w-5xl space-y-6 rounded-2xl border border-slate-300/70 bg-white/85 p-8 shadow-xl shadow-slate-300/30 backdrop-blur">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Omni Director Phase 9.1 Web Bootstrap</h1>
          <p className="text-sm text-slate-600">
            Next.js App Router skeleton with PostgreSQL + MinIO local infrastructure.
          </p>
          <div>
            <Link
              href="/ops/queue"
              className="inline-flex items-center rounded-lg border border-indigo-500 bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
            >
              Open Queue Ops Console
            </Link>
          </div>
        </header>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          <div className="font-medium text-slate-900">Quick start</div>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>
              Run infra: <code className="rounded bg-slate-200 px-1 py-0.5">docker compose up -d</code>
            </li>
            <li>
              Install web deps: <code className="rounded bg-slate-200 px-1 py-0.5">npm --prefix apps/web install</code>
            </li>
            <li>
              Init DB schema: <code className="rounded bg-slate-200 px-1 py-0.5">npm --prefix apps/web run db:init</code>
            </li>
            <li>
              Start app: <code className="rounded bg-slate-200 px-1 py-0.5">npm --prefix apps/web run dev</code>
            </li>
          </ol>
        </section>

        <section>
          <h2 className="text-base font-semibold text-slate-900">Bootstrap API Surface</h2>
          <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Method</th>
                  <th className="px-3 py-2">Path</th>
                  <th className="px-3 py-2">Notes</th>
                </tr>
              </thead>
              <tbody>
                {endpoints.map((item) => (
                  <tr key={`${item.method}-${item.path}`} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-mono text-xs text-slate-700">{item.method}</td>
                    <td className="px-3 py-2 font-mono text-xs text-indigo-700">{item.path}</td>
                    <td className="px-3 py-2 text-slate-600">{item.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
