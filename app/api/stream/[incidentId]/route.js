import db from '../../../../lib/db.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req, { params }) {
  const { incidentId } = params;

  const encoder = new TextEncoder();
  let lastId = 0;

  const stream = new ReadableStream({
    start(controller) {
      const interval = setInterval(async () => {
        try {
          const result = await db.query(
            'SELECT * FROM incident_logs WHERE incident_id = $1 AND id > $2 ORDER BY id ASC',
            [incidentId, lastId]
          );
          const rows = result?.rows ?? [];

          for (const row of rows) {
            lastId = row.id;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(row)}\n\n`));
          }

          const isDone = rows.some(
            (row) =>
              (row.type === 'success' && row.message.includes('Incident closed')) ||
              row.type === 'error'
          );
          if (isDone) {
            clearInterval(interval);
            controller.close();
          }
        } catch {
          clearInterval(interval);
          controller.close();
        }
      }, 500);
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
