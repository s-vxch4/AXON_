import { scanRepository } from '../../../../../lib/scanner.js';
import db from '../../../../../lib/db.js';
import { createAppAuth } from '@octokit/auth-app';

export const dynamic = 'force-dynamic';

export async function POST(request, { params }) {
  const repoId = params.repoId;
  console.log(`[rescan] Received repoId=${repoId}`);

  try {
    await db.query('DELETE FROM scan_cache WHERE repo_id = $1', [repoId]);

    const result = await db.query('SELECT * FROM repositories WHERE id = $1', [repoId]);
    if (result.rows.length === 0) {
      return Response.json({ error: 'Repo not found' }, { status: 404 });
    }

    const repo = result.rows[0];

    const auth = createAppAuth({
      appId: process.env.GITHUB_APP_ID,
      privateKey: process.env.GITHUB_PRIVATE_KEY.replace(/\\n/g, '\n'),
    });
    const { token } = await auth({ type: 'installation', installationId: repo.installation_id });

    scanRepository(repo.owner, repo.repo, token, repoId).catch(console.error);

    return Response.json({ ok: true });
  } catch (err) {
    console.error('[rescan] error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}