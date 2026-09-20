import { scanRepository } from '../../../../../lib/scanner.js';
import db from '../../../../../lib/db.js';
import { createAppAuth } from '@octokit/auth-app';

export const dynamic = 'force-dynamic';

export async function POST(request, { params }) {
  const repoId = params.repoId;
  console.log(`[rescan] Force rescan clicked for repoId=${repoId}`);

  try {
    await db.query('DELETE FROM scan_cache WHERE repo_id = $1', [repoId]);
    console.log(`[rescan] Cleared scan cache for repoId=${repoId}`);

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

    console.log(`[rescan] Starting forced scan for ${repo.owner}/${repo.repo}`);
    await scanRepository(repo.owner, repo.repo, token, repoId, true);
    console.log(`[rescan] Forced scan completed; dependency_map refreshed for repoId=${repoId}`);

    return Response.json({ ok: true, forceRescan: true });
  } catch (err) {
    console.error('[rescan] error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}