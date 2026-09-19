import crypto from 'crypto';
import { logIncident } from './logger.js';
import { checkAffectedRepos } from './precheck.js';
import { generateFix } from './fixgen.js';
import { openPullRequest } from './pr.js';
import { sendSlackAlert } from './slack.js';
import { pollCIResult } from './ci.js';
import { getInstallationOctokit } from './github.js';

export async function triggerFixPipeline(apiName, breakingChanges, newSpecContent) {
  const incidentId = crypto.randomUUID();

  try {
    await logIncident(incidentId, `Spec change detected: ${apiName}`, 'info');

    const affectedRepos = await checkAffectedRepos(apiName, breakingChanges, incidentId);

    if (!affectedRepos || affectedRepos.length === 0) {
      return;
    }

    for (const row of affectedRepos) {
      const octokit = await getInstallationOctokit(row.installation_id);

      const fix = await generateFix(
        apiName,
        breakingChanges,
        row.file_path,
        row.line_number,
        `${row.method}(...)`,
        incidentId
      );

      const pr = await openPullRequest(
        row.owner,
        row.repo,
        row.installation_id,
        row.file_path,
        fix.fixed_code,
        apiName,
        breakingChanges[0],
        fix,
        incidentId
      );

      const confidenceScore = fix.confidence?.score ?? fix.confidence_score ?? 0;
      await sendSlackAlert(pr, apiName, row.file_path, confidenceScore);

      if (pr?.head?.sha) {
        await pollCIResult(row.owner, row.repo, pr.head.sha, incidentId, octokit);
      }
    }

    await logIncident(incidentId, 'Incident closed.', 'success');
  } catch (err) {
    await logIncident(incidentId, `Pipeline error: ${err.message}`, 'error');
    await sendSlackAlert(null, apiName, '', 0);
  }
}