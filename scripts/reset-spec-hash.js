// Resets the supportiq spec hash and content in the DB to the v6 baseline
// so the next push of openapi.yaml (v7) is detected as a breaking change.
import { neon } from '@neondatabase/serverless';
import crypto from 'crypto';

const sql = neon(process.env.DATABASE_URL);

// Check current state
const current = await sql.query("SELECT api_name, spec_hash, spec_content FROM api_specs WHERE api_name = 'supportiq'");
console.log('Current hash:', current[0].spec_hash);
console.log('Current content (first 150 chars):', current[0].spec_content?.slice(0, 150));

// Build the v6 spec content
const v6Content = `# test
openapi: 3.0.0
info:
  title: SupportIQ Chat API
  version: 1.0.0
paths:
  /api/chat-v6:
    post:
      operationId: sendMessage
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [message]
              properties:
                message:
                  type: string
      responses:
        '200':
          description: OK
`;

const v6Hash = crypto.createHash('sha256').update(v6Content).digest('hex');
console.log('\nResetting to v6 hash:', v6Hash);

await sql.query(
  "UPDATE api_specs SET spec_hash = $1, spec_content = $2 WHERE api_name = 'supportiq'",
  [v6Hash, v6Content]
);

console.log('✓ Done — spec_hash and spec_content reset to v6 baseline');
console.log('Now: make sure openapi.yaml on GitHub shows /api/chat-v7, then touch the file (add a space and commit) to trigger the webhook.');
