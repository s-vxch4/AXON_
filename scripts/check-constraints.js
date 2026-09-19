import { db } from '../lib/db.js';

const r = await db.query(
  "SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'repositories'::regclass"
);
console.log(r.rows);
process.exit(0);
