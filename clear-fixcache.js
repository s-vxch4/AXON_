import { db } from './lib/db.js';
async function clear() {
  const result = await db.query('DELETE FROM fix_cache');
  console.log('Deleted rows:', result.rowCount);
}
clear();
