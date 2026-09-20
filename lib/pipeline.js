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
    console.log(`\n[pipeline] ========== PIPELINE START ==========`);
    console.log(`[pipeline] api=${apiName} oldPath=${oldPath ?? 'n/a'} newPath=${newPath ?? 'n/a'}`);
    console.log(`[pipeline] breakingChanges.length=${breakingChanges?.length ?? 0} incidentId=${incidentId}`);

    const affectedRepos = await checkAffectedRepos(apiName, breakingChanges, incidentId);
    console.log(`[pipeline] → affectedRepos count: ${affectedRepos?.length ?? 0}`);

    if (!affectedRepos || affectedRepos.length === 0) {
      console.log('[pipeline] No affected repos found — pipeline exiting without action.');
      await logIncident(incidentId, `No affected repos found for ${apiName}. No PRs opened.`, 'info');
      return;
    }

    for (const row of affectedRepos) {
      console.log(`\n[pipeline] --- Processing file ${row.file_path} in ${row.owner}/${row.repo} ---`);
      if (!row.owner || !row.repo || !row.installation_id || !row.file_path) {
        console.error(`[pipeline] Incomplete row — skipping:`, JSON.stringify(row));
        continue; // skip this row rather than aborting the whole pipeline
      }

      const octokit = await getInstallationOctokit(row.installation_id);

      let realCodeSnippet;
      try {
        const { data: fileData } = await octokit.repos.getContent({
          owner: row.owner,
          repo: row.repo,
          path: row.file_path,
        });
        realCodeSnippet = Buffer.from(fileData.content, 'base64').toString('utf-8');
        console.log(`[pipeline] → Fetched file content: ${row.file_path} (${realCodeSnippet.length} chars)`);
      } catch (fetchErr) {
        console.error(`[pipeline] Failed to fetch ${row.file_path}: ${fetchErr.message} — skipping`);
        continue;
      }

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

      const hasFixedCode = typeof fix?.fixed_code === 'string' && fix.fixed_code.trim().length > 0;
      const confidence = fix?.confidence?.score ?? fix?.confidence_score ?? 0;
      console.log(`[pipeline] → Fix generated: hasFixedCode=${hasFixedCode} confidence=${confidence} deterministic=${fix?.deterministic ?? false}`);

      if (!hasFixedCode) {
        console.error(`[pipeline] generateFix returned empty fixed_code for ${row.file_path} — skipping`);
        continue;
      }

      // Verify fix contains newPath (sanity check before opening PR)
      if (newPath && !fix.fixed_code.includes(newPath)) {
        console.warn(`[pipeline] WARNING: fixed_code does not contain newPath="${newPath}" — PR may be incorrect`);
      } else if (newPath) {
        console.log(`[pipeline] ✓ fixed_code contains newPath="${newPath}"`);
      }

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
        throw new Error(`GitHub returned no PR URL for ${row.file_path}`);
      }
      console.log(`[pipeline] → PR opened: ${pr.html_url}`);

      const confidenceScore = fix.confidence?.score ?? fix.confidence_score ?? 0;
      await sendSlackAlert(pr, apiName, row.file_path, confidenceScore);

      // FIX: pass filePath and newPath so ci.js can do post-merge verification
      if (pr?.head?.sha) {
        console.log(`[pipeline] → Starting CI polling for PR #${pr.number} sha=${pr.head.sha}`);
        await pollCIResult(
          row.owner,
          row.repo,
          pr.head.sha,
          incidentId,
          octokit,
          pr.number,
          row.file_path,
          newPath
        );
      } else {
        console.warn(`[pipeline] PR #${pr.number} has no head.sha — cannot poll CI`);
      }
    }

    await logIncident(incidentId, `Pipeline complete for ${apiName}.`, 'success');
    console.log(`\n[pipeline] ========== PIPELINE COMPLETE ==========\n`);
  } catch (err) {
    console.error(`\n[pipeline] ❌ PIPELINE ERROR: ${err.message}`, err);
    await logIncident(incidentId, `Pipeline error: ${err.message}`, 'error');
    await sendSlackAlert(null, apiName, '', 0);
  } finally {
    activeRuns.delete(apiName);
    console.log(`[pipeline] Lock released for ${apiName}`);
  }
}
