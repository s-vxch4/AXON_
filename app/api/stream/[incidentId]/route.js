export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { db } from '../../../../lib/db.js';

export async function GET(request, { params }) {
  const { incidentId } = params;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let lastId = 0;
      let closed = false;

      while (!closed) {
        await new Promise((resolve) => setTimeout(resolve, 500));

        try {
          const rows = await db.query(
            'SELECT * FROM incident_logs WHERE incident_id = $1 AND id > $2 ORDER BY id ASC',
            [incidentId, lastId]
          );

          for (const row of rows) {
            const data = `data: ${JSON.stringify(row)}\n\n`;
            controller.enqueue(encoder.encode(data));
            lastId = row.id;

            if (
              (row.type === 'success' && row.message.includes('Incident closed')) ||
              row.type === 'error'
            ) {
              closed = true;
            }
          }
        } catch (err) {
          console.error('[stream] error:', err.message);
        }
      }

      controller.close();
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
