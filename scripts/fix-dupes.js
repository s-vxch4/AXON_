const { neon } = require('@neondatabase/serverless');
require('dotenv').config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL);

async function run() {
  // Delete all dupes, keep lowest id per owner+repo
  await sql`DELETE FROM repositories WHERE id NOT IN (SELECT MIN(id) FROM repositories GROUP BY owner, repo)`;
  
  // Add unique constraint to prevent future dupes
  await sql`ALTER TABLE repositories DROP CONSTRAINT IF EXISTS repositories_owner_repo_unique`;
  await sql`ALTER TABLE repositories ADD CONSTRAINT repositories_owner_repo_unique UNIQUE (owner, repo)`;
  
  const rows = await sql`SELECT id, owner, repo FROM repositories ORDER BY id`;
  console.log('Total rows:', rows.length);
  console.log(rows);
}

run().catch(console.error);
