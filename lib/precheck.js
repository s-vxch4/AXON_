import db from './db.js';
import { logIncident } from './logger.js';

export async function checkAffectedRepos(apiName, breakingChanges, incidentId) {
  let brokenMethods = breakingChanges.map((change) => change.operation).filter(Boolean);

  if (brokenMethods.length === 0) {
    brokenMethods = breakingChanges.map((change) => change.path).filter(Boolean);
  }

  const result = await db.query(
    `SELECT dm.*, r.owner, r.repo, r.installation_id
     FROM dependency_map dm
     JOIN repositories r ON dm.repo_id = r.id
     WHERE dm.api_name = $1`,
    [apiName]
  );
  const rows = result?.rows ?? result;

  if (rows.length === 0) {
    await logIncident(incidentId, `Breaking change detected in ${apiName}. No affected code found. No action taken.`, 'info');
    return [];
  }

  return rows;
}
