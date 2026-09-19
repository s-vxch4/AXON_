import db from '../../lib/db.js';
import IncidentLog from './IncidentLog.jsx';
import DependencyMap from './DependencyMap.jsx';

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  const repos = (await db.query('SELECT * FROM repositories ORDER BY created_at DESC'))?.rows ?? [];
  const apis = (await db.query('SELECT * FROM api_specs ORDER BY last_checked DESC'))?.rows ?? [];
  const incidents = (await db.query('SELECT DISTINCT ON (incident_id) incident_id, message, type, created_at FROM incident_logs ORDER BY incident_id, created_at DESC'))?.rows ?? [];

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white p-8">
      <div className="max-w-6xl mx-auto">
        <header className="mb-10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-8 w-8 text-emerald-400">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
              <path d="M5 12a7 7 0 0 0 14 0" />
              <line x1="12" y1="19" x2="12" y2="22" />
            </svg>
            <h1 className="text-2xl font-bold">Axon Dashboard</h1>
          </div>
          <a href="/" className="text-sm text-zinc-400 hover:text-white transition-colors">Home</a>
        </header>

        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-4 text-zinc-200">Connected Repositories</h2>
          <div className="space-y-3">
            {repos.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 p-4">
                <div>
                  <p className="font-medium text-white">{r.owner}/{r.repo}</p>
                  <p className="text-sm text-zinc-500">Owner: {r.owner}</p>
                </div>
                <form action={`/api/repos/${r.id}/rescan`} method="POST">
                  <button type="submit" className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500">
                    Force Rescan
                  </button>
                </form>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-4 text-zinc-200">Monitored APIs</h2>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-zinc-500">
                  <th className="px-4 py-3 font-medium">API Name</th>
                  <th className="px-4 py-3 font-medium">Last Checked</th>
                </tr>
              </thead>
              <tbody>
                {apis.map((a) => (
                  <tr key={a.api_name} className="border-b border-zinc-800/50 last:border-0">
                    <td className="px-4 py-3 font-mono text-emerald-400">{a.api_name}</td>
                    <td className="px-4 py-3 text-zinc-400">
                      {a.last_checked ? new Date(a.last_checked).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-4 text-zinc-200">Recent Incidents</h2>
          <div className="space-y-3">
            {incidents.map((inc, i) => (
              <div key={i} className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
                <p className="text-sm text-zinc-300">{inc.incident_id}</p>
                <p className="text-sm text-zinc-300">{inc.message}</p>
                <p className="text-xs text-zinc-500 mt-1">{inc.type}</p>
                <p className="text-xs text-zinc-600 mt-1">{inc.created_at ? new Date(inc.created_at).toLocaleString() : '—'}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-4 text-zinc-200">Dependency Map</h2>
          <DependencyMap repoId={repos[0]?.id} />
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-4 text-zinc-200">Incident Log</h2>
          <IncidentLog incidentId="demo" />
        </section>
      </div>
    </main>
  );
}