import db from './db.js';
import crypto from 'crypto';

export async function logIncident(incidentId, message, type) {
  await db.query(
    'INSERT INTO incident_logs (incident_id, message, type) VALUES ($1, $2, $3)',
    [incidentId, message, type]
  );
}

export function createIncidentId() {
  return crypto.randomUUID();
}
