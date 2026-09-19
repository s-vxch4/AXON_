import fs from 'fs';
import path from 'path';
import http from 'isomorphic-git/http/node/index.js';
import db from './db.js';
import { callLLM } from './llm.js';
import { extractJSON } from './utils.js';
import { getInstallationOctokit } from './github.js';

export async function cloneRepo(owner, repo, installationToken) {
  const dir = `/tmp/${owner}-${repo}`;

  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const { default: git } = await import('isomorphic-git');
  const url = `https://github.com/${owner}/${repo}.git`;

  await git.clone({
    fs,
    http,
    dir,
    url,
    depth: 1,
    singleBranch: true,
    onAuth: () => ({
      username: 'x-access-token',
      password: installationToken,
    }),
  });

  return dir;
}

export function getAllSourceFiles(dir, extensions) {
  const results = [];

  function walk(currentPath) {
    const entries = fs.readdirSync(currentPath);
    for (const entry of entries) {
      if (entry === 'node_modules' || entry === '.git') continue;
      const fullPath = path.join(currentPath, entry);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else {
        const ext = path.extname(fullPath);
        if (extensions.includes(ext)) {
          results.push(fullPath);
        }
      }
    }
  }

  walk(dir);
  return results;
}

export async function scanRepository(owner, repo, installationToken, repoId) {
  const octokit = await getInstallationOctokit(installationToken);

  const branchData = await octokit.repos.getBranch({
    owner,
    repo,
    branch: 'main',
  });
  const commitSha = branchData.data.commit.sha;

  const cached = await db.query(
    'SELECT * FROM scan_cache WHERE repo_id = $1 AND commit_sha = $2',
    [repoId, commitSha]
  );
  if (cached?.rows?.length > 0) {
    return;
  }

  const cloneDir = await cloneRepo(owner, repo, installationToken);
  const files = getAllSourceFiles(cloneDir, ['.js', '.ts', '.py']);

  let concatenated = '';
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const relativePath = path.relative(cloneDir, file);
    concatenated += `// FILE: ${relativePath}\n${content}\n\n`;
  }

  const systemPrompt =
    'You are a code analysis tool. Respond with only valid JSON. No explanation. No markdown. No backticks.';

  const userPrompt = `Analyze the following codebase and find every call to these APIs: Stripe, Twilio, OpenAI, SendGrid, GitHub, mock-payment-api.

Return a JSON array of objects with these fields:
[
  { "api": "stripe", "method": "charges.create", "file": "src/services/checkout.js", "line": 42 }
]

Codebase:
${concatenated.slice(0, 50000)}`;

  const raw = await callLLM([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]);

  const dependencies = extractJSON(raw);

  await db.query('DELETE FROM dependency_map WHERE repo_id = $1', [repoId]);

  for (const dep of dependencies) {
    await db.query(
      `INSERT INTO dependency_map (repo_id, api_name, method, file_path, line_number)
       VALUES ($1, $2, $3, $4, $5)`,
      [repoId, dep.api, dep.method, dep.file, dep.line || 0]
    );
  }

  await db.query(
    `INSERT INTO scan_cache (repo_id, commit_sha, scanned_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (repo_id, commit_sha) DO NOTHING`,
    [repoId, commitSha]
  );

}
