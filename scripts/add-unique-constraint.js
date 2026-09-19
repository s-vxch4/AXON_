import { db } from '../lib/db.js';

await db.query(
  "ALTER TABLE repositories ADD CONSTRAINT repositories_owner_repo_unique UNIQUE (owner, repo)"
);
console.log("Constraint added.");
process.exit(0);
