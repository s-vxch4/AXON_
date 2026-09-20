import db from './db.js';
import { logIncident } from './logger.js';

// FIX: The old method-filter logic silently dropped ALL rows when oasdiff
// breakingChanges objects have neither .operation nor .path (they use .id,
// .text, etc. depending on the oasdiff version).  The fix:
//   1. Always query by api_name first — this is the stable key the scanner
//      writes and the monitor passes in.  api_name never changes when a path
//      is renamed; that is exactly why we store it separately.
//   2. Build the method filter only when we have real method tokens AND only
//      apply it when normalizedMethods is non-empty.  When it is empty we
//      return ALL rows for that api_name (correct — every consumer is affected).
//   3. Add explicit row-count proof logs at every step so failures are
//      immediately visible in the terminal.

export async function checkAffectedRepos(apiName, breakingChanges, incidentId) {
  console.log(`\n[precheck] ========== PRECHECK START ==========`);
  console.log(`[precheck] api_name=${apiName} breakingChanges.length=${breakingChanges?.length ?? 0}`);

  // --- Step 1: query dependency_map by api_name only ---
  // This is the critical join: scanner writes api_name from api_specs,
  // monitor passes the same api_name here.  No method/path needed to find rows.
  let rows = [];
  try {
    const result = await db.query(
      `SELECT dm.*, r.owner, r.repo, r.installation_id
       FROM dependency_map dm
       JOIN repositories r ON dm.repo_id = r.id
       WHERE dm.api_name = $1`,
      [apiName]
    );
    rows = result?.rows ?? [];
  } catch (err) {
    console.error(`[precheck] DB query failed: ${err.message}`);
    throw err;
  }

  console.log(`[precheck] ✓ dependency_map rows for api_name="${apiName}": ${rows.length}`);
  if (rows.length === 0) {
    console.warn(
      `[precheck] WARNING: 0 rows found. ` +
      `Either the scanner has not run yet, or the api_name written by scanner ` +
      `("${apiName}") does not match what is stored in dependency_map. ` +
      `Run Force Rescan first.`
    );
    await logIncident(
      incidentId,
      `Breaking change detected in ${apiName}. No dependency_map rows found — run Force Rescan first.`,
      'info'
    );
    return [];
  }

  // Log every row so we can verify in the terminal
  rows.forEach((row, i) => {
    console.log(
      `[precheck]   row[${i}] repo_id=${row.repo_id} owner=${row.owner} ` +
      `repo=${row.repo} file=${row.file_path}:${row.line_number} ` +
      `method="${row.method}"`
    );
  });

  // --- Step 2: optional method-level filter ---
  // Extract meaningful method tokens from the breaking-change objects.
  // oasdiff JSON typically looks like: { id: "...", text: "...", level: 3 }
  // We try multiple fields so this works across oasdiff versions.
  const methodTokens = (breakingChanges ?? [])
    .flatMap((change) => [
      change.operation,   // oasdiff v2: "POST"
      change.method,      // some formats
      change.path,        // oasdiff v1: "/api/chat-v6"
    ])
    .filter(Boolean)
    .map((t) => String(t).trim().toUpperCase());

  console.log(`[precheck] Method tokens from breaking changes: [${methodTokens.join(', ') || 'none'}]`);

  // If no usable tokens, return all rows (every consumer of this API is affected)
  if (methodTokens.length === 0) {
    console.log(`[precheck] No method tokens — treating all ${rows.length} rows as affected`);
    console.log(`[precheck] ========== PRECHECK END: ${rows.length} affected rows ==========\n`);
    return rows;
  }

  // Apply filter: a row matches if its method column contains any token
  const affectedRows = rows.filter((row) => {
    const depMethod = String(row.method || '').trim().toUpperCase();
    return methodTokens.some(
      (token) =>
        depMethod === token ||
        depMethod.endsWith(` ${token}`) ||
        depMethod.startsWith(`${token} `) ||
        depMethod.includes(token)
    );
  });

  console.log(
    `[precheck] After method filter: ${affectedRows.length}/${rows.length} rows match tokens [${methodTokens.join(', ')}]`
  );

  if (affectedRows.length === 0) {
    // Fall back to all rows — a path rename changes the URL but the HTTP
    // method stays the same (e.g. POST /api/chat-v6 → POST /api/chat-v7).
    // The method filter may miss this if the token was the OLD path string.
    // Better to process all consumers than silently skip them.
    console.warn(
      `[precheck] Method filter returned 0 rows — falling back to all ${rows.length} rows. ` +
      `This happens when oasdiff tokens don't match the stored method column.`
    );
    await logIncident(
      incidentId,
      `Breaking change in ${apiName}: method filter matched 0 rows, falling back to all ${rows.length} consumers.`,
      'info'
    );
    console.log(`[precheck] ========== PRECHECK END: ${rows.length} affected rows (fallback) ==========\n`);
    return rows;
  }

  await logIncident(
    incidentId,
    `Breaking change in ${apiName}: ${affectedRows.length} affected file(s) found.`,
    'info'
  );

  console.log(`[precheck] ========== PRECHECK END: ${affectedRows.length} affected rows ==========\n`);
  return affectedRows;
}
