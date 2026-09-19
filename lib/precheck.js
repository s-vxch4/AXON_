import { db } from './db.js';
import { logIncident } from './logger.js';

export async function checkAffectedRepos(apiName, breakingChanges, incidentId) {
  const brokenMethods = breakingChanges
    .map((c) => c.operation)
    .filter(Boolean);

  if (brokenMethods.length === 0) {
    await logIncident(incidentId, `No specific methods identified in breaking changes for ${apiName}`, 'warning');
    return [];
  }

  const rows = await db.query(
    `SELECT dm.*, r.owner, r.repo, r.installation_id
     FROM dependency_map dm
     JOIN repositories r ON dm.repo_id = r.id
     WHERE dm.api_name = $1 AND dm.method = ANY($2)`,
    [apiName, brokenMethods]
  );

  if (!rows || rows.length === 0) {
    await logIncident(incidentId, `No affected repos found for ${apiName}`, 'info');
    return [];
  }

  return rows;
}
