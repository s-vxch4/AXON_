import db from './db.js';
import { logIncident } from './logger.js';

export async function checkAffectedRepos(apiName, breakingChanges, incidentId) {
  let brokenMethods = breakingChanges.map((change) => change.operation).filter(Boolean);

  if (brokenMethods.length === 0) {
    brokenMethods = breakingChanges.map((change) => change.path).filter(Boolean);
  }

  const normalizedMethods = brokenMethods.map((method) => String(method).trim().toUpperCase());
  console.log(`[precheck] Breaking change detected for api_name=${apiName}; methods=${normalizedMethods.join(', ') || 'unknown'}`);

  const result = await db.query(
    `SELECT dm.*, r.owner, r.repo, r.installation_id
     FROM dependency_map dm
     JOIN repositories r ON dm.repo_id = r.id
     WHERE dm.api_name = $1`,
    [apiName]
  );
  const rows = result?.rows ?? result;
  console.log(`[precheck] Found ${rows.length} dependency_map rows for api_name=${apiName}`);

  const affectedRows = normalizedMethods.length === 0
    ? rows
    : rows.filter((row) => {
      const dependencyMethod = String(row.method || '').trim().toUpperCase();
      return normalizedMethods.some((method) => (
        dependencyMethod === method
        || dependencyMethod.endsWith(` ${method}`)
        || dependencyMethod.includes(method)
      ));
    });

  console.log(`[precheck] Affected repos found: ${affectedRows.length}`);

  if (affectedRows.length === 0) {
    await logIncident(incidentId, `Breaking change detected in ${apiName}. No affected code found. No action taken.`, 'info');
    return [];
  }

  return affectedRows;
}
