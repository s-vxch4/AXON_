import cron from 'node-cron';
import db from './db.js';
import { checkSpecForChanges } from './monitor.js';

export function startCron() {
  const schedule = process.env.NODE_ENV === 'development' ? '*/2 * * * *' : '0 */6 * * *';
  cron.schedule(schedule, async () => {
    console.log('[cron] tick started');
    const result = await db.query('SELECT * FROM api_specs');
    for (const spec of result.rows) {
      await checkSpecForChanges(spec);
    }
  });
}
