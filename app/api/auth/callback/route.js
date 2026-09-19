import { App } from '@octokit/app';
import { db } from '../../../../lib/db.js';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');

  if (!code) {
    return Response.json({ error: 'No code provided' }, { status: 400 });
  }

  const app = new App({
    appId: process.env.GITHUB_APP_ID,
    privateKey: process.env.GITHUB_PRIVATE_KEY.replace(/\\n/g, '\n'),
    oauth: {
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    },
  });

  const { authentication } = await app.oauth.createToken({ code });
  const installationId = authentication.installationId;

  const octokit = await app.getInstallationOctokit(installationId);
  const { data: repos } = await octokit.apps.listReposAccessibleToInstallation();

  for (const repo of repos.repositories) {
    await db.query(
      `INSERT INTO repositories (owner, repo, installation_id)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [repo.owner.login, repo.name, String(installationId)]
    );
  }

  return Response.redirect(new URL('/dashboard', request.url));
}