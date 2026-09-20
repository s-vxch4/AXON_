import pg from 'pg';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// FIX: Use a direct pg Pool instead of the Neon serverless driver.
// The Neon driver uses HTTP fetch which is designed for short-lived serverless
// request handlers. Inside a ReadableStream's setInterval (which runs outside
// the request lifecycle) the fetch-based connection times out immediately,
// producing "Error connecting to database: TypeError: fetch failed" every 500ms.
// A standard pg Pool maintains a persistent TCP connection — reliable for
// long-running polling like SSE.
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false, sslmode: 'verify-full' },
  max: 3,
  idleTimeoutMillis: 60000,
});

export async function GET(req, { params }) {
  const { incidentId } = params;

  // Guard: never stream for the placeholder "demo" incidentId —
  // that's what page.js passes when no real incident is active.
  // It would hammer the DB every 500ms forever for zero rows.
  if (!incidentId || incidentId === 'demo') {
    return new Response(
      'data: {"type":"info","message":"No active incident — waiting for pipeline to run."}\n\n',
      {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      }
    );
  }

  const encoder = new TextEncoder();
  let lastId = 0;
  let interval = null;

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      function closeStream() {
        if (closed) return;
        closed = true;
        clearInterval(interval);
        try { controller.close(); } catch { /* already closed */ }
      }

      interval = setInterval(async () => {
        if (closed) return;

        let client;
        try {
          client = await pool.connect();
          const result = await client.query(
            'SELECT * FROM incident_logs WHERE incident_id = $1 AND id > $2 ORDER BY id ASC',
            [incidentId, lastId]
          );
          const rows = result.rows;

          for (const row of rows) {
            if (closed) break;
            lastId = row.id;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(row)}\n\n`));
          }

          const isDone = rows.some(
            (row) =>
              (row.type === 'success' && row.message.includes('Pipeline complete')) ||
              (row.type === 'success' && row.message.includes('Incident closed')) ||
              row.type === 'error'
          );
          if (isDone) closeStream();

        } catch (err) {
          console.error(`[stream] DB error for incident ${incidentId}:`, err.message);
          // Don't close — a transient DB hiccup shouldn't kill the stream.
          // It will retry on the next tick.
        } finally {
          if (client) client.release();
        }
      }, 1000); // 1s interval — less aggressive than 500ms
    },

    cancel() {
      clearInterval(interval);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
