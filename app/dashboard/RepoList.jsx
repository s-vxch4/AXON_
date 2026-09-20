'use client';

import { useState } from 'react';

// FIX: The old Force Rescan button was a plain <form method="POST"> that caused
// a full-page navigation. In Next.js App Router the server component re-renders
// on navigation but the client DependencyMap does NOT re-fetch because its
// repoId prop hasn't changed. Result: the dependency table always showed stale
// data after a rescan.
//
// Solution: make Force Rescan a client-side fetch() call. On success:
//   1. Show the returned dependencyCount immediately in the button area
//   2. Increment a refreshKey prop on DependencyMap so its useEffect re-fires

export default function RepoList({ repos, onRescanComplete }) {
  const [scanning, setScanning] = useState({});   // repoId -> true while in flight
  const [results, setResults] = useState({});      // repoId -> { dependencyCount, error }

  async function handleRescan(repoId) {
    setScanning((s) => ({ ...s, [repoId]: true }));
    setResults((r) => ({ ...r, [repoId]: null }));

    console.log(`[dashboard] Force rescan clicked for repoId=${repoId}`);

    try {
      const res = await fetch(`/api/repos/${repoId}/rescan`, { method: 'POST' });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      console.log(
        `[dashboard] Rescan complete for repoId=${repoId}: ` +
        `dependencyCount=${data.dependencyCount} api_name=${data.apiName}`
      );

      setResults((r) => ({
        ...r,
        [repoId]: { dependencyCount: data.dependencyCount, apiName: data.apiName },
      }));

      // Notify parent (dashboard page) so DependencyMap refreshKey increments
      if (onRescanComplete) onRescanComplete(repoId, data);

    } catch (err) {
      console.error(`[dashboard] Rescan error for repoId=${repoId}:`, err.message);
      setResults((r) => ({ ...r, [repoId]: { error: err.message } }));
    } finally {
      setScanning((s) => ({ ...s, [repoId]: false }));
    }
  }

  return (
    <div className="space-y-3">
      {repos.map((r) => {
        const isScanning = scanning[r.id];
        const result = results[r.id];

        return (
          <div key={r.id} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <div>
              <p className="font-medium text-white">{r.owner}/{r.repo}</p>
              <p className="text-sm text-zinc-500">Owner: {r.owner}</p>
              {result && !result.error && (
                <p className="text-xs text-emerald-400 mt-1">
                  ✓ Scan complete — {result.dependencyCount} dependency row(s) written
                  {result.apiName ? ` for api_name="${result.apiName}"` : ''}
                </p>
              )}
              {result?.error && (
                <p className="text-xs text-red-400 mt-1">✗ Scan failed: {result.error}</p>
              )}
            </div>
            <button
              type="button"
              disabled={isScanning}
              onClick={() => handleRescan(r.id)}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isScanning ? 'Scanning…' : 'Force Rescan'}
            </button>
          </div>
        );
      })}
    </div>
  );
}
