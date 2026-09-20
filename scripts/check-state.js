// Check actual file content in the repo + DB state
import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);
const auth = createAppAuth({
  appId: process.env.GITHUB_APP_ID,
  privateKey: process.env.GITHUB_PRIVATE_KEY.replace(/\\n/g, '\n'),
});
const { token } = await auth({ type: 'installation', installationId: '162409822' });
const octokit = new Octokit({ auth: token });

// Check actual file in GitHub
const f = await octokit.repos.getContent({ owner: 's-vxch4', repo: 'supportiq', path: 'src/escalate.js' });
console.log('=== src/escalate.js (live on GitHub) ===');
console.log(Buffer.from(f.data.content, 'base64').toString('utf8'));

// Check DB dependency_map
const deps = await sql.query('SELECT api_name, method, file_path FROM dependency_map ORDER BY file_path');
console.log('\n=== dependency_map rows ===');
deps.forEach(r => console.log(`  api_name=${r.api_name}  method=${r.method}  file=${r.file_path}`));

// Check api_specs
const specs = await sql.query('SELECT api_name, spec_url FROM api_specs ORDER BY api_name');
console.log('\n=== api_specs ===');
specs.forEach(r => console.log(`  api_name=${r.api_name}  url=${r.spec_url}`));
