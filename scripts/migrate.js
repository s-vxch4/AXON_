import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

const tables = [
  `CREATE TABLE IF NOT EXISTS repositories (
    id SERIAL PRIMARY KEY,
    owner TEXT NOT NULL,
    repo TEXT NOT NULL,
    installation_id TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS dependency_map (
    id SERIAL PRIMARY KEY,
    repo_id INTEGER REFERENCES repositories(id),
    api_name TEXT NOT NULL,
    method TEXT NOT NULL,
    file_path TEXT NOT NULL,
    line_number INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS scan_cache (
    repo_id INTEGER REFERENCES repositories(id),
    commit_sha TEXT NOT NULL,
    scanned_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (repo_id, commit_sha)
  )`,
  `CREATE TABLE IF NOT EXISTS fix_cache (
    id SERIAL PRIMARY KEY,
    cache_key TEXT UNIQUE NOT NULL,
    fixed_code TEXT NOT NULL,
    confidence_score INTEGER NOT NULL,
    explanation TEXT NOT NULL,
    times_used INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS incident_logs (
    id SERIAL PRIMARY KEY,
    incident_id TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS api_specs (
    id SERIAL PRIMARY KEY,
    api_name TEXT UNIQUE NOT NULL,
    spec_url TEXT NOT NULL,
    spec_hash TEXT NOT NULL,
    spec_content TEXT NOT NULL,
    last_checked TIMESTAMP DEFAULT NOW()
  )`,
];

async function run() {
  for (const tableSql of tables) {
    await sql.query(tableSql);
    const match = tableSql.match(/CREATE TABLE IF NOT EXISTS (\w+)/);
    const name = match ? match[1] : 'unknown';
    console.log(`[migrate] created table: ${name}`);
  }
  console.log('[migrate] all tables created successfully');
}

run().catch((err) => {
  console.error('[migrate] error:', err);
  process.exit(1);
});
