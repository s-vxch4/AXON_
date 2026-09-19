import fs from 'fs';
import path from 'path';
import http from 'isomorphic-git/http/node';
import db from './db.js';
import { callLLM } from './llm.js';
import { extractJSON } from './utils.js';
import { Octokit } from '@octokit/rest';

async function queryDb(label, text, params = []) {
  console.log(`[scanner] DB ${label}`, { text, params });

  try {
    const result = await db.query(text, params);
    console.log(`[scanner] DB ${label} succeeded`, { rowCount: result.rows.length });
    return result;
  } catch (error) {
    console.error(`[scanner] DB ${label} failed`, { text, params, error });
    throw error;
  }
}

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
  try {
    const repoIdInt = parseInt(repoId, 10);

    if (isNaN(repoIdInt)) {
      throw new Error(`Invalid repoId: ${repoId}`);
    }

    console.log(`[scanner] Starting scan for repo_id=${repoIdInt} (${owner}/${repo})`);

    const octokit = new Octokit({ auth: installationToken });

    const branchData = await octokit.repos.getBranch({
      owner,
      repo,
      branch: 'main',
    });
    const commitSha = branchData.data.commit.sha;

    console.log(`[scanner] Current commit SHA: ${commitSha}`);

    const cached = await queryDb(
      'check scan cache',
      'SELECT * FROM scan_cache WHERE repo_id = $1 AND commit_sha = $2',
      [repoIdInt, commitSha]
    );
    if (cached?.rows?.length > 0) {
      console.log('[scanner] Scan cache hit, skipping');
      return;
    }

    const cloneDir = await cloneRepo(owner, repo, installationToken);
    const files = getAllSourceFiles(cloneDir, ['.js', '.ts', '.py']);

    console.log(`[scanner] Found ${files.length} source files`);

    let concatenated = '';
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      const relativePath = path.relative(cloneDir, file).replace(/\\/g, '/');
      concatenated += `// FILE: ${relativePath}\n${content}\n\n`;
    }

    const systemPrompt = 'You are a code analysis tool. Respond with only a valid JSON array. No explanation. No markdown. No backticks. No text before or after the array.';

    const userPrompt = `Look at this codebase and find every outbound HTTP fetch() call or API client call.

For each call found, return a JSON array like this:
[{"api":"supportiq","method":"POST /api/chat","file":"src/inbox.js","line":2}]

Rules:
- Set "api" to "supportiq" for any fetch to /api/chat or /chat
- Set "method" to the HTTP method and path being called (e.g. "POST /api/chat")
- Set "file" to the relative file path using forward slashes
- Set "line" to the line number as an integer
- Return ONLY the raw JSON array, nothing else

Codebase:
${concatenated.slice(0, 30000)}`;

    const raw = await callLLM([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]);

    console.log('[scanner] LLM raw response:', raw.slice(0, 500));

    const dependencies = extractJSON(raw);

    console.log(`[scanner] Found ${dependencies.length} dependencies`);

    await queryDb('delete dependency map rows', 'DELETE FROM dependency_map WHERE repo_id = $1', [repoIdInt]);

    for (const dep of dependencies) {
      const result = await queryDb(
        `insert dependency ${dep.api || 'unknown'}`,
        `INSERT INTO dependency_map (repo_id, api_name, method, file_path, line_number)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [repoIdInt, dep.api, dep.method, dep.file, dep.line || 0]
      );
      console.log(`[scanner] Inserted dep id=${result.rows[0].id} api=${dep.api} file=${dep.file} line=${dep.line}`);
    }

    await queryDb(
      'write scan cache',
      `INSERT INTO scan_cache (repo_id, commit_sha, scanned_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (repo_id, commit_sha) DO NOTHING`,
      [repoIdInt, commitSha]
    );

    console.log('[scanner] Scan complete');

  } catch (err) {
    console.error('[scanner] scanRepository error:', err);
    throw err;
  }
}