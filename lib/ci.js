import { logIncident } from './logger.js';

export async function pollCIResult(owner, repo, branchSha, incidentId, octokit, prNumber) {
  for (let i = 0; i < 24; i++) {
    await new Promise((resolve) => setTimeout(resolve, 15000));

    const { data } = await octokit.checks.listForRef({
      owner,
      repo,
      ref: branchSha,
    });

    const runs = data.check_runs;

    if (!runs || runs.length === 0) {
      await logIncident(incidentId, 'No CI configured — review manually before merging.', 'warning');
      return;
    }

    const allCompleted = runs.every((r) => r.status === 'completed');
    if (allCompleted) {
      const allSuccess = runs.every((r) => r.conclusion === 'success');
      if (allSuccess) {
        await logIncident(incidentId, 'CI passed on all checks. Safe to review and merge.', 'success');
        try {
          await octokit.pulls.merge({
            owner,
            repo,
            pull_number: prNumber,
            merge_method: 'squash',
          });
          await logIncident(incidentId, `PR #${prNumber} auto-merged after CI passed.`, 'success');
        } catch (mergeErr) {
          await logIncident(incidentId, `Auto-merge failed: ${mergeErr.message}`, 'error');
        }
      } else {
        await logIncident(incidentId, 'CI failed — manual review required before merging.', 'warning');
      }
      return;
    }
  }

  await logIncident(incidentId, 'CI polling timeout — check GitHub Actions directly.', 'info');
}