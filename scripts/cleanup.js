import db from '../lib/db.js';

await db.query("DELETE FROM api_specs WHERE api_name = 'mock-payment-api'");
await db.query("DELETE FROM repositories WHERE repo = 'mock-payment-api'");
await db.query("DELETE FROM repositories WHERE repo = 'demo-customer-app-axon'");
console.log('cleanup done');
process.exit(0);