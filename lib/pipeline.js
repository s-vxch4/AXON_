import crypto from 'crypto';
import { logIncident } from './logger.js';
import { checkAffectedRepos } from './precheck.js';
import { generateFix } from './fixgen.js';
import { openPullRequest } from './pr.js';
import { sendSlackAlert } from './slack.js';
import { pollCIResult } from './ci.js';
import { getInstallationOctokit } from './github.js';

// FIX 1: Run-lock to prevent duplicate pipeline execution
// When GitHub delivers the same webhook twice (common behavior), the second
// trigger for the same apiName is ignored while the first is still running.
const activeRuns = new Set();

export async function triggerFixPipeline(apiName, breakingChanges, newSpecContent, oldPath, newPath) {

  // FIX 1: Check and set lock before doing anything
  if (activeRuns.has(apiName)) {
    console.log(`[pipeline] Skipping duplicate trigger for ${apiName} — already in progress.`);
    return;
  }
  activeRuns.add(apiName);

  const incidentId = crypto.randomUUID();

  try {
    await logIncident(incidentId, `Spec change detected: ${apiName}`, 'info');
    console.log(`[pipeline] Breaking change detected for ${apiName}`);
    console.log(`[pipeline] Starting pipeline for ${apiName}`);

    const affectedRepos = await checkAffectedRepos(apiName, breakingChanges, incidentId);
    console.log(`[pipeline] affectedRepos count: ${affectedRepos?.length}`);

    if (!affectedRepos || affectedRepos.length === 0) {
      console.log('[pipeline] No affected repos found. Exiting.');
      return;
    }

    for (const row of affectedRepos) {
      console.log(`[pipeline] Processing repo: ${row.owner}/${row.repo} file: ${row.file_path}`);
      if (!row.owner || !row.repo || !row.installation_id || !row.file_path) {
        throw new Error(`Incomplete affected repository row: ${JSON.stringify(row)}`);
      }

      const octokit = await getInstallationOctokit(row.installation_id);

      const { data: fileData } = await octokit.repos.getContent({
        owner: row.owner,
        repo: row.repo,
        path: row.file_path,
      });
      const realCodeSnippet = Buffer.from(fileData.content, 'base64').toString('utf-8');
      console.log(`[pipeline] Fetched real file content for ${row.file_path} (${realCodeSnippet.length} chars)`);

      const fix = await generateFix(
        apiName,
        breakingChanges,
        row.file_path,
        row.line_number,
        realCodeSnippet,
        incidentId,
        oldPath,
        newPath
      );
      console.log('[pipeline] Fix generated:', {
        hasFixedCode: typeof fix?.fixed_code === 'string' && fix.fixed_code.length > 0,
        confidence: fix?.confidence?.score ?? fix?.confidence_score,
      });

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
      if (!pr?.html_url) {
        throw new Error('GitHub returned no pull request URL');
      }
      console.log(`[pipeline] PR opened: ${pr?.html_url}`);

      const confidenceScore = fix.confidence?.score ?? fix.confidence_score ?? 0;
      await sendSlackAlert(pr, apiName, row.file_path, confidenceScore);

      if (pr?.head?.sha) {
        await pollCIResult(row.owner, row.repo, pr.head.sha, incidentId, octokit, pr.number);
      }
    }

    await logIncident(incidentId, 'Incident closed.', 'success');
    console.log('[pipeline] Incident closed.');
  } catch (err) {
    console.error(`[pipeline] ERROR: ${err.message}`, err);
    await logIncident(incidentId, `Pipeline error: ${err.message}`, 'error');
    await sendSlackAlert(null, apiName, '', 0);
  } finally {
    // FIX 1: Always release the lock, even if pipeline threw an error
    activeRuns.delete(apiName);
    console.log(`[pipeline] Lock released for ${apiName}`);
  }
}
