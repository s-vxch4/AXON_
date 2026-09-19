import crypto from 'crypto';
import db from './db.js';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { triggerFixPipeline } from './pipeline.js';

export async function checkSpecForChanges(spec) {
  console.log(`[monitor] Checking spec for ${spec.api_name}`);
  
  const res = await fetch(spec.spec_url);
  const newSpecContent = await res.text();
  const newHash = crypto.createHash('sha256').update(newSpecContent).digest('hex');

  console.log(`[monitor] Old hash: ${spec.spec_hash}`);
  console.log(`[monitor] New hash: ${newHash}`);

  if (newHash === spec.spec_hash) {
    console.log(`[monitor] No change detected for ${spec.api_name}`);
    return;
  }

  console.log(`[monitor] Change detected for ${spec.api_name} — running oasdiff`);

  const tmpDir = os.tmpdir();
  const oldSpecPath = path.join(tmpDir, 'old-spec.yaml');
  const newSpecPath = path.join(tmpDir, 'new-spec.yaml');
  
  fs.writeFileSync(oldSpecPath, spec.spec_content);
  fs.writeFileSync(newSpecPath, newSpecContent);

  console.log(`[monitor] Wrote specs to ${oldSpecPath} and ${newSpecPath}`);

  let breakingChanges = [];
  try {
    const output = execSync(`oasdiff breaking "${oldSpecPath}" "${newSpecPath}" -f json`, {
      timeout: 30000,
    }).toString();
    breakingChanges = JSON.parse(output);
  } catch (err) {
    if (err.stdout) {
      try {
        breakingChanges = JSON.parse(err.stdout.toString());
        console.log(`[monitor] Breaking changes found: ${breakingChanges.length}`);
      } catch (e) {
        console.error('[monitor] Failed to parse oasdiff output:', err.stdout.toString().slice(0, 200));
      }
    } else {
      console.error('[monitor] oasdiff error:', err.message);
    }
  }

  await db.query(
    'UPDATE api_specs SET spec_hash = $1, spec_content = $2, last_checked = NOW() WHERE api_name = $3',
    [newHash, newSpecContent, spec.api_name]
  );

  console.log(`[monitor] Breaking changes count: ${breakingChanges.length}`);

  if (breakingChanges.length > 0) {
    await triggerFixPipeline(spec.api_name, breakingChanges, newSpecContent);
  }
}