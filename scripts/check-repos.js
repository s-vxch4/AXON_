const { neon } = require('@neondatabase/serverless');
require('dotenv').config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL);

async function run() {
  const rows = await sql`SELECT id, owner, repo, installation_id FROM repositories ORDER BY id`;
  console.log('Total rows:', rows.length);
  console.log(rows);
}

run().catch(console.error);