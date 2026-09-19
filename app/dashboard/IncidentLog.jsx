'use client';

import { useEffect, useRef, useState } from 'react';

export default function IncidentLog({ incidentId }) {
  const [logs, setLogs] = useState([]);
  const [connected, setConnected] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!incidentId) return;

    const es = new EventSource(`/api/stream/${incidentId}`);

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        setLogs((prev) => [...prev, data]);
      } catch (_) {
        // ignore parse errors
      }
    };

    return () => {
      es.close();
      setConnected(false);
    };
  }, [incidentId]);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  function colorFor(type) {
    switch (type) {
      case 'success':
        return 'text-emerald-400';
      case 'error':
        return 'text-red-400';
      case 'warning':
        return 'text-yellow-400';
      default:
        return 'text-zinc-200';
    }
  }

  return (
    <div
      ref={containerRef}
      className="h-64 overflow-y-auto rounded-lg border border-zinc-800 bg-black p-4 font-mono text-sm"
    >
      <div className="mb-2 text-xs text-zinc-600">
        {connected ? 'Connected' : 'Disconnected'} — incident: {incidentId}
      </div>
      {logs.length === 0 && (
        <div className="text-zinc-600">Waiting for events...</div>
      )}
      {logs.map((log, i) => (
        <div key={i} className={`whitespace-pre-wrap ${colorFor(log.type)}`}>
          <span className="text-zinc-600">[{log.type || 'info'}]</span>{' '}
          {log.message}
        </div>
      ))}
    </div>
  );
}
