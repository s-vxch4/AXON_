import { logIncident } from './logger.js';

// FIX: After a successful auto-merge, re-fetch the merged file from GitHub
// and log whether the new path is present. This gives visual proof in the
// terminal that the dependency was actually updated, not just that CI passed.
async function verifyMergedFile(octokit, owner, repo, filePath, newPath, incidentId) {
  if (!filePath || !newPath) {
    console.log('[ci] verifyMergedFile: no filePath or newPath — skipping post-merge verification');
    return;
  }

  console.log(`[ci] Post-merge verification: fetching merged file ${filePath} from main`);
  try {
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path: filePath,
      ref: 'main',
    });

    const mergedContent = Buffer.from(data.content, 'base64').toString('utf-8');
    const newPathPresent = mergedContent.includes(newPath);

    if (newPathPresent) {
      console.log(
        `[ci] ✅ POST-MERGE VERIFIED: "${newPath}" IS present in merged ${filePath} — dependency correctly updated`
      );
      await logIncident(
        incidentId,
        `Post-merge verified: "${newPath}" found in ${filePath}. Dependency successfully updated.`,
        'success'
      );
    } else {
      console.error(
        `[ci] ❌ POST-MERGE VERIFICATION FAILED: "${newPath}" NOT found in merged ${filePath}. ` +
        `The merge happened but the file may not contain the expected new path. Manual review required.`
      );
      await logIncident(
        incidentId,
        `Post-merge WARNING: "${newPath}" not found in merged ${filePath}. Manual review required.`,
        'warning'
      );
    }

    // Log a snippet around the first API call in the merged file for visual confirmation
    const lines = mergedContent.split('\n');
    const apiLines = lines
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => line.includes('/api/'));
    if (apiLines.length > 0) {
      console.log(`[ci] Merged file API call lines:`);
      apiLines.forEach(({ line, i }) =>
        console.log(`[ci]   line ${i + 1}: ${line.trim()}`)
      );
    }
  } catch (err) {
    console.error(`[ci] Could not fetch merged file for verification: ${err.message}`);
    await logIncident(
      incidentId,
      `Post-merge verification skipped: could not fetch ${filePath}: ${err.message}`,
      'warning'
    );
  }
}

// FIX: pollCIResult now accepts filePath and newPath so post-merge verification
// can check the merged content. pipeline.js passes these from the dependency row.
export async function pollCIResult(
  owner,
  repo,
  branchSha,
  incidentId,
  octokit,
  prNumber,
  filePath,
  newPath
) {
  console.log(
    `\n[ci] ========== CI POLLING START ==========`
  );
  console.log(
    `[ci] ${owner}/${repo} ref=${branchSha} pr=#${prNumber} file=${filePath ?? 'n/a'} newPath=${newPath ?? 'n/a'}`
  );

  for (let i = 0; i < 24; i++) {
    // Wait 15 seconds between polls (first iteration also waits so GitHub has
    // time to register the checks before we query)
    await new Promise((resolve) => setTimeout(resolve, 15000));

    let runs = [];
    try {
      const { data } = await octokit.checks.listForRef({
        owner,
        repo,
        ref: branchSha,
      });
      runs = data.check_runs ?? [];
    } catch (err) {
      console.error(`[ci] Poll ${i + 1}/24: checks.listForRef failed: ${err.message}`);
      continue;
    }

    const statusSummary = runs.map((r) => `${r.name}:${r.status}/${r.conclusion ?? '-'}`).join(', ');
    console.log(`[ci] Poll ${i + 1}/24: ${runs.length} check run(s) — ${statusSummary || 'none'}`);

    if (runs.length === 0) {
      console.log(`[ci] No CI checks found yet — will retry`);
      // After 3 polls with no checks assume no CI configured
      if (i >= 2) {
        console.warn(`[ci] No CI configured after ${i + 1} polls — treating as no-CI repo`);
        await logIncident(incidentId, 'No CI configured — skipping auto-merge. Review PR manually.', 'warning');
        return;
      }
      continue;
    }

    const allCompleted = runs.every((r) => r.status === 'completed');
    if (!allCompleted) {
      console.log(`[ci] Checks still running — waiting...`);
      continue;
    }

    // All checks completed
    const allSuccess = runs.every((r) => r.conclusion === 'success' || r.conclusion === 'skipped');
    const failedRuns = runs.filter((r) => r.conclusion !== 'success' && r.conclusion !== 'skipped');

    if (!allSuccess) {
      console.error(
        `[ci] ❌ CI FAILED — ${failedRuns.length} check(s) did not pass: ` +
        failedRuns.map((r) => `${r.name}:${r.conclusion}`).join(', ')
      );
      await logIncident(
        incidentId,
        `CI failed on check(s): ${failedRuns.map((r) => r.name).join(', ')}. Manual review required.`,
        'warning'
      );
      return;
    }

    // All checks succeeded — auto-merge
    console.log(`[ci] ✓ All CI checks passed — attempting auto-merge of PR #${prNumber}`);
    await logIncident(incidentId, `CI passed on all ${runs.length} check(s). Attempting auto-merge.`, 'success');

    try {
      // FIX: GitHub computes PR mergeability asynchronously after creation.
      // Wait 3 seconds before calling merge() to avoid HTTP 405 "not mergeable yet".
      console.log(`[ci] Waiting 3s for GitHub mergeability computation...`);
      await new Promise((resolve) => setTimeout(resolve, 3000));

      await octokit.pulls.merge({
        owner,
        repo,
        pull_number: prNumber,
        merge_method: 'squash',
      });

      console.log(`[ci] ✅ PR #${prNumber} auto-merged successfully (squash)`);
      await logIncident(incidentId, `PR #${prNumber} auto-merged after CI passed.`, 'success');

      // FIX: Post-merge verification — re-fetch the merged file and confirm new path
      await verifyMergedFile(octokit, owner, repo, filePath, newPath, incidentId);

    } catch (mergeErr) {
      console.error(`[ci] Auto-merge FAILED for PR #${prNumber}: ${mergeErr.message}`);
      await logIncident(incidentId, `Auto-merge failed: ${mergeErr.message}`, 'error');
    }

    console.log(`[ci] ========== CI POLLING END ==========\n`);
    return;
  }

  // Timeout after 24 × 15s = 6 minutes
  console.warn(`[ci] CI polling timeout (6 min) — check GitHub Actions directly for PR #${prNumber}`);
  await logIncident(incidentId, `CI polling timeout after 6 min — check GitHub Actions for PR #${prNumber}.`, 'info');
  console.log(`[ci] ========== CI POLLING END (timeout) ==========\n`);
}
