import db from '../lib/db.js';

async function run() {
  await db.query(`
    DELETE FROM repositories a
    USING repositories b
    WHERE a.id > b.id
    AND a.owner = b.owner
    AND a.repo = b.repo
  `);
  console.log('[dedupe] duplicates removed');
}

run();