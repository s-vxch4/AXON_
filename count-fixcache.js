import { db } from './lib/db.js'; async function count() { const result = await db.query('SELECT COUNT(*) FROM fix_cache'); console.log(JSON.stringify(result)); } count();
