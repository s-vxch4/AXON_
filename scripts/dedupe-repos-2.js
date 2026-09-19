import { db } from '../lib/db.js';

await db.query(`
  DELETE FROM repositories a
  USING repositories b
  WHERE a.id > b.id
    AND a.owner = b.owner
    AND a.repo = b.repo
`);
console.log("Duplicates removed.");
process.exit(0);
