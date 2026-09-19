import { Octokit } from '@octokit/rest';
import { getInstallationOctokit } from './github.js';
import { logIncident } from './logger.js';

export async function openPullRequest(owner, repo, installationId, affectedFile, fixedCode, apiName, breakingChange, fix, incidentId) {
  const octokit = await getInstallationOctokit(installationId);

  const branchName = `axon/fix-${apiName}-${Date.now()}`.replace(/[^a-zA-Z0-9/_-]/g, '-');

  const { data: refData } = await octokit.git.getRef({
    owner,
    repo,
    ref: 'heads/main',
  });
  await octokit.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branchName}`,
    sha: refData.object.sha,
  });

  const { data: fileData } = await octokit.repos.getContent({
    owner,
    repo,
    path: affectedFile,
  });
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

  const { data: pr } = await octokit.pulls.create({
    owner,
    repo,
    title: `[Axon] ${apiName} breaking change detected and patched`,
    head: branchName,
    base: 'main',
    body: prBody,
  });

  await logIncident(incidentId, `PR opened: ${pr.html_url}`, 'success');
  return pr;
}
