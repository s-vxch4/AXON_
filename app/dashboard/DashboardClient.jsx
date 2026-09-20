'use client';

import { useState } from 'react';
import RepoList from './RepoList.jsx';
import DependencyMap from './DependencyMap.jsx';
import IncidentLog from './IncidentLog.jsx';

export default function DashboardClient({ repos, firstRepoId, incidents = [] }) {
  const [refreshKey, setRefreshKey]       = useState(0);
  const [activeRepoId, setActiveRepoId]   = useState(firstRepoId);
  // FIX: liveIncidentId starts null — no SSE stream opens until the user
  // clicks an incident or the pipeline fires a new one. Eliminates the
  // "Error connecting to database: fetch failed" spam from the old hardcoded
  // incidentId="demo" that polled the DB every 500ms on every page load.
  const [liveIncidentId, setLiveIncidentId] = useState(null);

  function handleRescanComplete(repoId) {
    setActiveRepoId(repoId);
    setRefreshKey((k) => k + 1);
  }

  function badgeColor(type) {
    if (type === 'success') return 'text-emerald-400 bg-emerald-400/10';
    if (type === 'error')   return 'text-red-400 bg-red-400/10';
    if (type === 'warning') return 'text-yellow-400 bg-yellow-400/10';
    return 'text-zinc-400 bg-zinc-800';
  }

  return (
    <>
      {/* ── Connected Repositories ── */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4 text-zinc-200">Connected Repositories</h2>
        <RepoList repos={repos} onRescanComplete={handleRescanComplete} />
      </section>

      {/* ── Dependency Map ── */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4 text-zinc-200">
          Dependency Map
          {refreshKey > 0 && (
            <span className="ml-2 text-xs font-normal text-emerald-400">(refreshed {refreshKey}×)</span>
          )}
        </h2>
        <DependencyMap repoId={activeRepoId} refreshKey={refreshKey} />
      </section>

      {/* ── Recent Incidents ── */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4 text-zinc-200">Recent Incidents</h2>
        {incidents.length === 0 ? (
          <p className="text-sm text-zinc-500">No incidents yet.</p>
        ) : (
          <div className="space-y-2">
            {incidents.map((inc) => (
              <div
                key={inc.incident_id}
                onClick={() => setLiveIncidentId(inc.incident_id)}
                className={`cursor-pointer rounded-lg border p-4 transition-colors ${
                  liveIncidentId === inc.incident_id
                    ? 'border-emerald-700 bg-emerald-950/30'
                    : 'border-zinc-800 bg-zinc-900 hover:border-zinc-700'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-mono text-xs text-zinc-500 truncate">{inc.incident_id}</p>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${badgeColor(inc.type)}`}>
                    {inc.type}
                  </span>
                </div>
                <p className="mt-1 text-sm text-zinc-300">{inc.message}</p>
                <p className="mt-1 text-xs text-zinc-600">
                  {inc.created_at ? new Date(inc.created_at).toLocaleString() : '—'}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Live Incident Stream ── */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4 text-zinc-200">
          Live Incident Stream
          {liveIncidentId && (
            <button
              onClick={() => setLiveIncidentId(null)}
              className="ml-3 text-xs font-normal text-zinc-500 hover:text-white"
            >
              ✕ close
            </button>
          )}
        </h2>
        {liveIncidentId ? (
          <IncidentLog incidentId={liveIncidentId} />
        ) : (
          <div className="rounded-lg border border-zinc-800 bg-black p-4 font-mono text-sm text-zinc-600">
            Click an incident above to stream its logs here.
          </div>
        )}
      </section>
    </>
  );
}
