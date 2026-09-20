import { db } from './lib/db.js';

async function check() {
  const result = await db.query(
    "SELECT api_name, spec_hash, LEFT(spec_content, 300) as preview, last_checked FROM api_specs WHERE api_name = 'supportiq'"
  );
  console.log(JSON.stringify(result.rows, null, 2));
}

check();
