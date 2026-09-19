import { logIncident } from './logger.js';

export async function pollCIResult(owner, repo, branchSha, incidentId, octokit) {
  for (let i = 0; i < 24; i++) {
    await new Promise((resolve) => setTimeout(resolve, 15000));

    const checks = await octokit.checks.listForRef({
      owner,
      repo,
      ref: branchSha,
    });

    const runs = checks.data.check_runs;

    if (!runs || runs.length === 0) {
      await logIncident(incidentId, 'No CI configured — review manually before merging.', 'warning');
      return;
    }

    const allCompleted = runs.every((r) => r.status === 'completed');
    if (allCompleted) {
      const allSuccess = runs.every((r) => r.conclusion === 'success');
      if (allSuccess) {
        await logIncident(incidentId, 'CI passed on all checks.', 'success');
      } else {
        await logIncident(incidentId, 'CI failed — manual review required.', 'warning');
      }
      return;
    }
  }

  await logIncident(incidentId, 'CI polling timeout.', 'info');
}
