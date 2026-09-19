import { db } from '../../../../../lib/db.js';
import { scanRepository } from '../../../../../lib/scanner.js';

export async function POST(request, { params }) {
  const { repoId } = params;

  await db.query('DELETE FROM scan_cache WHERE repo_id = $1', [repoId]);
  await db.query('DELETE FROM fix_cache WHERE cache_key LIKE $1', [`${repoId}:%`]);

  const repos = await db.query('SELECT * FROM repositories WHERE id = $1', [repoId]);

  if (repos && repos.length > 0) {
    const repo = repos[0];
    try {
      await scanRepository(repo.owner, repo.repo, repo.installation_id, repoId);
    } catch (err) {
      console.error('[rescan] error:', err.message);
    }
  }

  return Response.json({ ok: true });
}
