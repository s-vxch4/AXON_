'use client';

import { useEffect, useState } from 'react';

export default function DependencyMap({ repoId }) {
  const [dependencies, setDependencies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!repoId) return;

    let active = true;

    fetch(`/api/repos/${repoId}/dependencies`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load dependencies');
        return res.json();
      })
      .then((data) => {
        if (active) {
          setDependencies(data.dependencies || []);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [repoId]);

  const grouped = {};
  for (const dep of dependencies) {
    if (!grouped[dep.api_name]) grouped[dep.api_name] = [];
    grouped[dep.api_name].push(dep);
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-500">
        Loading dependencies...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-sm text-red-400">
        {error}
      </div>
    );
  }

  if (dependencies.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-500">
        No dependencies found. Run a rescan to populate.
      </div>
    );
  }

  return (
    <div className="space-y-4">
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
