// One-off script: updates all 5 src/ files in s-vxch4/supportiq to use /api/chat-v6
// matching the openapi.yaml spec path, ready for the demo.
// Run with: node scripts/sync-supportiq-files.js

import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';

const auth = createAppAuth({
  appId: process.env.GITHUB_APP_ID,
  privateKey: process.env.GITHUB_PRIVATE_KEY.replace(/\\n/g, '\n'),
});
const { token } = await auth({ type: 'installation', installationId: '162409822' });
const octokit = new Octokit({ auth: token });

const OWNER = 's-vxch4';
const REPO  = 'supportiq';

const files = {
  'src/escalate.js': `export async function shouldEscalate(ticketContent) {
  const res = await fetch('/api/chat-v6', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: ticketContent }),
  });
  return res;
}
`,
  'src/inbox.js': `export async function autoReply(ticketContent) {
  const res = await fetch('/api/chat-v6', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: ticketContent }),
  });
  return res;
}
`,
  'src/livechat.js': `export async function sendLiveChatMessage(message) {
  const res = await fetch('/api/chat-v6', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  return res;
}
`,
  'src/suggest.js': `export async function suggestReply(context) {
  const res = await fetch('/api/chat-v6', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: context }),
  });
  return res;
}
`,
  'src/summarize.js': `export async function summarizeThread(thread) {
  const res = await fetch('/api/chat-v6', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: thread }),
  });
  return res;
}
`,
};

for (const [filePath, newContent] of Object.entries(files)) {
  const existing = await octokit.repos.getContent({ owner: OWNER, repo: REPO, path: filePath });
  await octokit.repos.createOrUpdateFileContents({
    owner: OWNER,
    repo: REPO,
    path: filePath,
    message: `chore: align ${filePath} to /api/chat-v6 (matches openapi.yaml)`,
    content: Buffer.from(newContent).toString('base64'),
    sha: existing.data.sha,
    branch: 'main',
  });
  console.log(`✓ Updated: ${filePath}`);
}

console.log('\nAll 5 src/ files now call /api/chat-v6. Ready for demo.');
