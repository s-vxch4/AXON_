const { neon } = require('@neondatabase/serverless');
require('dotenv').config({ path: '.env.local' });
const db = neon(process.env.DATABASE_URL);

async function run() {
  await db.query('INSERT INTO repositories (owner, repo, installation_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', ['s-vxch4', 'mock-payment-api', '162409822']);
  await db.query('INSERT INTO repositories (owner, repo, installation_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', ['s-vxch4', 'demo-customer-app-axon', '162409822']);
  console.log('Done');
}
run();