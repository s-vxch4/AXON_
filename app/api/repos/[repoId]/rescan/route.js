import { scanRepository } from '../../../../../lib/scanner.js';
import db from '../../../../../lib/db.js';
import { createAppAuth } from '@octokit/auth-app';

export const dynamic = 'force-dynamic';

export async function POST(request, { params }) {
  const repoId = params.repoId;
  console.log(`\n[rescan] ========== FORCE RESCAN CLICKED ==========`);
  console.log(`[rescan] repoId=${repoId}`);

  try {
    // FIX: scanRepository already deletes the cache internally when forceRescan=true,
    // but we keep this pre-clear here as a belt-and-suspenders safety net in case
    // the scan fails partway through — we don't want a stale cache blocking the retry.
    await db.query('DELETE FROM scan_cache WHERE repo_id = $1', [repoId]);
    console.log(`[rescan] Pre-cleared scan_cache for repoId=${repoId}`);

    const result = await db.query('SELECT * FROM repositories WHERE id = $1', [repoId]);
    if (result.rows.length === 0) {
      console.error(`[rescan] Repo not found for id=${repoId}`);
      return Response.json({ error: 'Repo not found' }, { status: 404 });
    }

    const repo = result.rows[0];
    console.log(`[rescan] Repo found: ${repo.owner}/${repo.repo} installation_id=${repo.installation_id}`);

    const auth = createAppAuth({
      appId: process.env.GITHUB_APP_ID,
      privateKey: process.env.GITHUB_PRIVATE_KEY.replace(/\\n/g, '\n'),
    });
    const { token } = await auth({ type: 'installation', installationId: repo.installation_id });

    console.log(`[rescan] Auth token obtained — starting scan`);

    // FIX: scanRepository now returns { dependencyCount, cached, apiName }
    // We await full completion before responding so the dashboard row count
    // is accurate the moment the button response arrives.
    const scanResult = await scanRepository(repo.owner, repo.repo, token, repoId, true);

    const dependencyCount = scanResult?.dependencyCount ?? 0;
    const apiName = scanResult?.apiName ?? 'unknown';

    console.log(
      `[rescan] ✓ Forced scan complete — ` +
      `dependency_map has ${dependencyCount} rows for repoId=${repoId} api_name=${apiName}`
    );
    console.log(`[rescan] ========== FORCE RESCAN DONE ==========\n`);

    // FIX: Return dependency count so the client can display it without a
    // separate fetch, and so the dashboard can confirm the map populated.
    return Response.json({
      ok: true,
      forceRescan: true,
      dependencyCount,
      apiName,
    });
  } catch (err) {
    console.error('[rescan] ❌ ERROR:', err.message, err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
