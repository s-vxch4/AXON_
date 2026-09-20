import crypto from 'crypto';
import db from './db.js';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { triggerFixPipeline } from './pipeline.js';

// FIX: More robust path extractor.
// Old regex anchored to exactly 2 leading spaces, which breaks if the YAML
// uses 4-space indents or different formatting.
// New approach: match any line that starts with optional whitespace then a
// forward-slash (path key in OpenAPI paths: block), capturing the path value.
function extractPaths(specContent) {
  if (!specContent) return [];
  // Matches lines like:   /api/chat-v6:  or  /api/chat-v7:
  // Handles 2-space, 4-space, or any leading whitespace
  const matches = [...specContent.matchAll(/^[ \t]+(\/[^\s:{}]+)\s*:/gm)];
  return [...new Set(matches.map((m) => m[1]))]; // deduplicate
}

export async function checkSpecForChanges(spec) {
  console.log(`\n[monitor] ========== SPEC CHECK START ==========`);
  console.log(`[monitor] api_name=${spec.api_name} spec_url=${spec.spec_url}`);

  if (!spec.spec_url) {
    console.error('[monitor] spec_url is missing — cannot fetch spec');
    return;
  }

  let newSpecContent;
  try {
    const res = await fetch(spec.spec_url);
    if (!res.ok) {
      console.error(`[monitor] Failed to fetch spec: HTTP ${res.status} from ${spec.spec_url}`);
      return;
    }
    newSpecContent = await res.text();
  } catch (err) {
    console.error(`[monitor] Network error fetching spec: ${err.message}`);
    return;
  }

  const newHash = crypto.createHash('sha256').update(newSpecContent).digest('hex');

  console.log(`[monitor] Old hash: ${spec.spec_hash ?? '(none — first run)'}`);
  console.log(`[monitor] New hash: ${newHash}`);

  // FIX: On first run spec_hash is null — treat null as "always changed" so
  // the first push always writes the hash and sets the baseline.
  if (spec.spec_hash && newHash === spec.spec_hash) {
    console.log(`[monitor] No change detected for ${spec.api_name}`);
    return;
  }

  if (!spec.spec_hash) {
    console.log(`[monitor] First run for ${spec.api_name} — storing baseline hash, no pipeline triggered`);
    await db.query(
      'UPDATE api_specs SET spec_hash = $1, spec_content = $2, last_checked = NOW() WHERE api_name = $3',
      [newHash, newSpecContent, spec.api_name]
    );
    return;
  }

  console.log(`[monitor] ✓ Change detected for ${spec.api_name} — running oasdiff`);

  const tmpDir = os.tmpdir();
  const oldSpecPath = path.join(tmpDir, 'old-spec.yaml');
  const newSpecPath = path.join(tmpDir, 'new-spec.yaml');

  // FIX: Guard against null spec_content (race condition on first run)
  const oldContent = spec.spec_content ?? '';
  fs.writeFileSync(oldSpecPath, oldContent);
  fs.writeFileSync(newSpecPath, newSpecContent);

  console.log(`[monitor] Wrote specs to tmp: old=${oldSpecPath} new=${newSpecPath}`);

  let breakingChanges = [];
  try {
    const output = execSync(`oasdiff breaking "${oldSpecPath}" "${newSpecPath}" -f json`, {
      timeout: 30000,
    }).toString();
    breakingChanges = JSON.parse(output);
    console.log(`[monitor] oasdiff: ${breakingChanges.length} breaking changes (clean exit)`);
  } catch (err) {
    // oasdiff exits with code 1 when breaking changes ARE found, writing JSON to stdout.
    // The error object has .stdout when the process produced output before exiting.
    if (err.stdout) {
      const raw = err.stdout.toString().trim();
      try {
        breakingChanges = JSON.parse(raw);
        console.log(`[monitor] oasdiff: ${breakingChanges.length} breaking changes (exit 1 with output)`);
      } catch (parseErr) {
        console.error('[monitor] Failed to parse oasdiff stdout as JSON:', raw.slice(0, 300));
      }
    } else {
      console.error('[monitor] oasdiff error (no stdout):', err.message);
    }
  }

  console.log(`[monitor] Breaking changes count: ${breakingChanges.length}`);
  if (breakingChanges.length > 0) {
    breakingChanges.forEach((bc, i) =>
      console.log(`[monitor]   bc[${i}]:`, JSON.stringify(bc))
    );
  }

  // Persist the new hash + content BEFORE triggering the pipeline so that if
  // the webhook fires twice the second delivery sees the updated hash and skips.
  await db.query(
    'UPDATE api_specs SET spec_hash = $1, spec_content = $2, last_checked = NOW() WHERE api_name = $3',
    [newHash, newSpecContent, spec.api_name]
  );
  console.log(`[monitor] Persisted new hash for ${spec.api_name}`);

  if (breakingChanges.length > 0) {
    // FIX: More robust path-change extraction.
    // extractPaths now handles variable indentation.
    const oldPaths = extractPaths(oldContent);
    const newPaths = extractPaths(newSpecContent);

    console.log(`[monitor] Old paths: [${oldPaths.join(', ')}]`);
    console.log(`[monitor] New paths: [${newPaths.join(', ')}]`);

    // removedPath = path that was in old spec but not in new
    const removedPath = oldPaths.find((p) => !newPaths.includes(p)) ?? null;
    // addedPath = path that is in new spec but not in old
    const addedPath = newPaths.find((p) => !oldPaths.includes(p)) ?? null;

    console.log(`[monitor] Path change: ${removedPath ?? '(none)'} -> ${addedPath ?? '(none)'}`);
    console.log(`[monitor] Triggering fix pipeline for api_name=${spec.api_name}`);

    await triggerFixPipeline(
      spec.api_name,
      breakingChanges,
      newSpecContent,
      removedPath,
      addedPath
    );
  } else {
    console.log(`[monitor] No breaking changes — pipeline not triggered`);
  }

  console.log(`[monitor] ========== SPEC CHECK END ==========\n`);
}
