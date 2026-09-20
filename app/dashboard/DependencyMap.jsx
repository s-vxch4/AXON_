'use client';

import { useEffect, useState } from 'react';

// FIX: Accept a refreshKey prop. When the parent increments it (after a
// successful Force Rescan), the useEffect re-runs and re-fetches the latest
// dependency_map rows — no full page reload needed.
export default function DependencyMap({ repoId, refreshKey = 0 }) {
  const [dependencies, setDependencies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!repoId) {
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    console.log(`[DependencyMap] Fetching dependencies for repoId=${repoId} (refreshKey=${refreshKey})`);

    fetch(`/api/repos/${repoId}/dependencies`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (active) {
          const deps = data.dependencies || [];
          console.log(`[DependencyMap] Loaded ${deps.length} dependency row(s) for repoId=${repoId}`);
          setDependencies(deps);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (active) {
          console.error(`[DependencyMap] Fetch error: ${err.message}`);
          setError(err.message);
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId, refreshKey]);

  const grouped = {};
  for (const dep of dependencies) {
    const key = dep.api_name || 'unknown';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(dep);
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-500">
        Loading dependencies…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-sm text-red-400">
        Error loading dependencies: {error}
      </div>
    );
  }

  if (dependencies.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-500">
        No dependencies found. Click Force Rescan to populate.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-500">{dependencies.length} total row(s) in dependency_map</p>
      {Object.entries(grouped).map(([apiName, deps]) => (
        <div key={apiName}>
          <div className="mb-2 flex items-center gap-2">
            <span className="font-mono text-emerald-400">{apiName}</span>
            <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
              {deps.length} {deps.length === 1 ? 'call' : 'calls'}
            </span>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-zinc-500">
                  <th className="px-4 py-2 font-medium">API</th>
                  <th className="px-4 py-2 font-medium">Method</th>
                  <th className="px-4 py-2 font-medium">File</th>
                  <th className="px-4 py-2 font-medium">Line</th>
                </tr>
              </thead>
              <tbody>
                {deps.map((dep, i) => (
                  <tr key={i} className="border-b border-zinc-800/50 last:border-0">
                    <td className="px-4 py-2 font-mono text-emerald-400">{dep.api_name}</td>
                    <td className="px-4 py-2 font-mono text-zinc-300">{dep.method}</td>
                    <td className="px-4 py-2 font-mono text-zinc-400">{dep.file_path}</td>
                    <td className="px-4 py-2 text-zinc-400">{dep.line_number}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
