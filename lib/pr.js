import { Octokit } from '@octokit/rest';
import { logIncident } from './logger.js';

export async function openPullRequest(owner, repo, installationToken, affectedFile, fixedCode, apiName, breakingChange, fix, incidentId) {
  const octokit = new Octokit({ auth: installationToken });

  const branchName = `axon/fix-${apiName}-${Date.now()}`;

  const baseRef = await octokit.git.getRef({
    owner,
    repo,
    ref: 'heads/main',
  });
  const baseSha = baseRef.data.object.sha;

  await octokit.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branchName}`,
    sha: baseSha,
  });

  const fileContent = await octokit.repos.getContent({
    owner,
    repo,
    path: affectedFile,
  });
  const fileSha = fileContent.data.sha;

  const contentBase64 = Buffer.from(fixedCode).toString('base64');

  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: affectedFile,
    message: `fix: patch ${apiName} breaking change — Axon`,
    content: contentBase64,
    branch: branchName,
    sha: fileSha,
  });

  const confidenceScore = fix.confidence?.score ?? 0;
  const confidenceLabel =
    confidenceScore >= 70
      ? `\u2705 ${confidenceScore}%`
      : `\u26a0\ufe0f ${confidenceScore}% — Requires careful review`;

  const prBody = `## Axon — Automated Fix PR

### What changed
API \`${apiName}\` had a breaking change: \`${breakingChange.operation || breakingChange.id || 'unknown'}\`

### Affected code
File: \`${affectedFile}\`

### Fix applied
\`\`\`
${fixedCode}
\`\`\`

### Confidence
${confidenceLabel}

### Action required
Review the changes. If confidence is below 70%, test thoroughly before merging.
`;

  const pr = await octokit.pulls.create({
    owner,
    repo,
    title: `fix: patch ${apiName} breaking change — Axon`,
    head: branchName,
    base: 'main',
    body: prBody,
  });

  await logIncident(incidentId, `PR opened: ${pr.data.html_url}`, 'success');
  console.log(`[pr] ${pr.data.html_url}`);

  return pr.data;
}
