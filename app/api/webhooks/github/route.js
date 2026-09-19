import db from '../../../../lib/db.js';
import { checkSpecForChanges } from '../../../../lib/monitor.js';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const event = request.headers.get('x-github-event');
  const payload = await request.json();

  if (event === 'push') {
    const repoName = payload.repository?.name;
    if (repoName) {
      const specs = await db.query(
        'SELECT * FROM api_specs WHERE api_name = $1',
        [repoName]
      );
      if (specs.rows && specs.rows.length > 0) {
        await checkSpecForChanges(specs.rows[0]);
      }
    }
  }

  return Response.json({ ok: true });
}
