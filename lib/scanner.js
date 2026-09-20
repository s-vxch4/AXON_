import fs from 'fs';
import path from 'path';
import http from 'isomorphic-git/http/node';
import db from './db.js';
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

// FIX: Deterministic regex-based dependency detection.
// Previously api_name was hardcoded as 'supportiq' — this meant precheck's
// WHERE api_name = $1 (using the spec's api_name, e.g. 'supportiq') would
// only ever match if you happened to use that exact string. Now we accept
// apiName from the caller (the api_specs row) and store it correctly.
//
// Regex scope expanded: previously only matched /api/chat paths.
// Now matches ANY /api/ call so any monitored API's consumers are detected.
// Pattern captures: fetch('/api/...'), axios.get('/api/...'), etc.
// The captured URL is stored in the `method` column as "POST /api/chat-v6"
// and precheck's method filter handles matching.
function detectDependencies(cloneDir, files, apiName) {
  const dependencies = [];

  // Matches: fetch('/api/...'), axios.post('/api/...'), etc.
  // Group 1: http method keyword (fetch or axios.METHOD)
  // Group 2: the URL path starting with /api/
  const callPattern =
    /(fetch|axios\.(?:get|post|put|patch|delete))\s*\(\s*[`'"]([^`'"]*\/api\/[^`'"]+)[`'"]/i;

  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch (e) {
      console.warn(`[scanner] Could not read ${file}: ${e.message}`);
      continue;
    }

    const relativePath = path.relative(cloneDir, file).replace(/\\/g, '/');
    const lines = content.split('\n');

    lines.forEach((line, idx) => {
      const match = line.match(callPattern);
      if (match) {
        const rawMethod = match[1].toLowerCase();
        const urlPath = match[2];

        // Derive HTTP method string: fetch() is usually POST for APIs,
        // but we store the actual axios method when we have it.
        let httpMethod = 'GET';
        if (rawMethod === 'fetch') {
          // Look for method: 'POST' / method: "POST" on the same or next lines
          const context = lines.slice(idx, idx + 5).join(' ');
          const methodMatch = context.match(/method\s*:\s*['"](\w+)['"]/i);
          httpMethod = methodMatch ? methodMatch[1].toUpperCase() : 'POST';
        } else {
          const axiosMethodMatch = rawMethod.match(/axios\.(\w+)/);
          httpMethod = axiosMethodMatch ? axiosMethodMatch[1].toUpperCase() : 'GET';
        }

        dependencies.push({
          api_name: apiName,
          method: `${httpMethod} ${urlPath}`,
          file: relativePath,
          line: idx + 1,
        });

        console.log(
          `[scanner]   FOUND dep api_name=${apiName} method=${httpMethod} ${urlPath} file=${relativePath}:${idx + 1}`
        );
      }
    });
  }

  return dependencies;
}

export async function scanRepository(owner, repo, installationToken, repoId, forceRescan = false) {
  try {
    const repoIdInt = parseInt(repoId, 10);

    if (isNaN(repoIdInt)) {
      throw new Error(`Invalid repoId: ${repoId}`);
    }

    console.log(
      `\n[scanner] ========== SCAN START ==========`
    );
    console.log(
      `[scanner] repo_id=${repoIdInt} (${owner}/${repo}) forceRescan=${forceRescan}`
    );

    const octokit = new Octokit({ auth: installationToken });

    const branchData = await octokit.repos.getBranch({
      owner,
      repo,
      branch: 'main',
    });
    const commitSha = branchData.data.commit.sha;

    console.log(`[scanner] Current commit SHA: ${commitSha}`);

    if (!forceRescan) {
      const cached = await queryDb(
        'check scan cache',
        'SELECT * FROM scan_cache WHERE repo_id = $1 AND commit_sha = $2',
        [repoIdInt, commitSha]
      );
      if (cached?.rows?.length > 0) {
        console.log('[scanner] Scan cache hit, skipping');
        return { dependencyCount: 0, cached: true };
      }
    } else {
      console.log('[scanner] Force rescan — bypassing cache');
      await queryDb(
        'clear scan cache',
        'DELETE FROM scan_cache WHERE repo_id = $1',
        [repoIdInt]
      );
    }

    // FIX: Look up the api_name for this repo by matching the spec_url against
    // the repo's owner/repo slug. This is reliable regardless of how many
    // api_specs rows exist — the spec_url for s-vxch4/supportiq contains
    // "s-vxch4/supportiq" so we match it with ILIKE.
    // Priority order:
    //   1. spec_url contains owner/repo  (most specific)
    //   2. api_name = repo name          (fallback for simple setups)
    //   3. repo name itself              (last resort)
    let apiName = repo; // last-resort fallback
    try {
      const slug = `${owner}/${repo}`;

      // Try exact slug match in spec_url first
      const specByUrl = await queryDb(
        'look up api_name by spec_url slug',
        `SELECT api_name FROM api_specs WHERE spec_url ILIKE $1 LIMIT 1`,
        [`%${slug}%`]
      );
      if (specByUrl?.rows?.length > 0) {
        apiName = specByUrl.rows[0].api_name;
        console.log(`[scanner] api_name=${apiName} (matched spec_url containing "${slug}")`);
      } else {
        // Try matching api_name = repo name
        const specByName = await queryDb(
          'look up api_name by repo name',
          `SELECT api_name FROM api_specs WHERE api_name = $1 LIMIT 1`,
          [repo]
        );
        if (specByName?.rows?.length > 0) {
          apiName = specByName.rows[0].api_name;
          console.log(`[scanner] api_name=${apiName} (matched api_name = repo name)`);
        } else {
          console.warn(`[scanner] No api_specs row matched for "${slug}" — using fallback api_name=${apiName}`);
        }
      }
    } catch (e) {
      console.warn(`[scanner] Could not look up api_name: ${e.message}; using fallback=${apiName}`);
    }

    const cloneDir = await cloneRepo(owner, repo, installationToken);
    console.log(`[scanner] Cloned to ${cloneDir}`);

    const files = getAllSourceFiles(cloneDir, ['.js', '.ts', '.jsx', '.tsx', '.py']);
    console.log(`[scanner] Found ${files.length} source files to scan`);

    // FIX: pass apiName so dependency_map rows have the correct api_name value
    const dependencies = detectDependencies(cloneDir, files, apiName);

    console.log(`\n[scanner] ---- SCAN RESULTS ----`);
    console.log(`[scanner] Total dependencies found: ${dependencies.length}`);
    if (dependencies.length === 0) {
      console.warn(
        `[scanner] WARNING: 0 dependencies detected. ` +
        `Check that the cloned repo contains fetch()/axios calls matching /api/ paths.`
      );
    }

    // FIX: DELETE first, then INSERT fresh rows — clean slate every rescan
    await queryDb('delete dependency map rows', 'DELETE FROM dependency_map WHERE repo_id = $1', [repoIdInt]);
    console.log(`[scanner] dependency_map cleared for repo_id=${repoIdInt}`);

    for (const dep of dependencies) {
      const result = await queryDb(
        `insert dep ${dep.api_name}`,
        `INSERT INTO dependency_map (repo_id, api_name, method, file_path, line_number)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [repoIdInt, dep.api_name, dep.method, dep.file, dep.line || 0]
      );
      console.log(
        `[scanner] Inserted dep id=${result.rows[0].id} api_name=${dep.api_name} method=${dep.method} file=${dep.file}:${dep.line}`
      );
    }

    console.log(
      `[scanner] ✓ dependency_map updated: ${dependencies.length} rows for repo_id=${repoIdInt} api_name=${apiName}`
    );

    await queryDb(
      'write scan cache',
      `INSERT INTO scan_cache (repo_id, commit_sha, scanned_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (repo_id, commit_sha) DO NOTHING`,
      [repoIdInt, commitSha]
    );

    console.log(`[scanner] ========== SCAN COMPLETE ==========\n`);

    // FIX: return dependency count so the rescan route can include it in its response
    return { dependencyCount: dependencies.length, cached: false, apiName };

  } catch (err) {
    console.error('[scanner] scanRepository FATAL ERROR:', err);
    throw err;
  }
}
