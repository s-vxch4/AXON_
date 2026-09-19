import { Octokit } from '@octokit/rest';
import { getInstallationOctokit } from './github.js';
import { logIncident } from './logger.js';

export async function openPullRequest(owner, repo, installationId, affectedFile, fixedCode, apiName, breakingChange, fix, incidentId) {
  console.log(`[pr] Opening PR for ${owner}/${repo}, file=${affectedFile}, installation=${installationId}`);

  if (!owner || !repo || !installationId || !affectedFile || typeof fixedCode !== 'string') {
    throw new Error('Missing or invalid pull request arguments');
  }

  const octokit = await getInstallationOctokit(installationId);

  const branchName = `axon/fix-${apiName}-${Date.now()}`.replace(/[^a-zA-Z0-9/_-]/g, '-');

  console.log(`[pr] Reading main branch SHA for ${owner}/${repo}`);
  const { data: refData } = await octokit.git.getRef({
    owner,
    repo,
    ref: 'heads/main',
  });
  if (!refData?.object?.sha) {
    throw new Error('GitHub main branch ref did not include a commit SHA');
  }

  console.log(`[pr] Creating branch ${branchName} from ${refData.object.sha}`);
  await octokit.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branchName}`,
    sha: refData.object.sha,
  });

  console.log(`[pr] Reading file SHA for ${affectedFile}`);
  const { data: fileData } = await octokit.repos.getContent({
    owner,
    repo,
    path: affectedFile,
  });
  if (!fileData?.sha) {
    throw new Error(`GitHub did not return a file SHA for ${affectedFile}`);
  }

  console.log(`[pr] Updating ${affectedFile} on branch ${branchName}`);
  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: affectedFile,
    message: `fix: patch ${apiName} breaking change — Axon`,
    content: Buffer.from(fixedCode).toString('base64'),
    branch: branchName,
    sha: fileData.sha,
  });

  const score = fix.confidence?.score ?? fix.confidence_score ?? 0;
  const confidenceLabel = score >= 70
    ? `\u2705 ${score}% confidence`
    : `\u26a0\ufe0f ${score}% confidence — Requires careful review`;

  const prBody = `## Axon — Automated Fix PR

### What changed
${breakingChange.text ?? `${apiName} breaking change`}

### Affected code
File: \`${affectedFile}\`

### Fix applied
${fix.explanation}

### Confidence
${confidenceLabel}

### Action required
Review before merging — Axon never auto-merges.
`;

  console.log(`[pr] Creating pull request from ${branchName} into main`);
  const { data: pr } = await octokit.pulls.create({
    owner,
    repo,
    title: `[Axon] ${apiName} breaking change detected and patched`,
    head: branchName,
    base: 'main',
    body: prBody,
  });

  console.log(`[pr] Pull request created: ${pr.html_url}`);
  await logIncident(incidentId, `PR opened: ${pr.html_url}`, 'success');
  return pr;
}
