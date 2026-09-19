import { App } from '@octokit/app';
import { db } from '../../../../lib/db.js';

export async function GET(request) {
  try {
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

    // Get user token from OAuth code
    const { authentication } = await app.oauth.createToken({ code });
    const userOctokit = await app.oauth.getUserOctokit({ token: authentication.token });

    // Get installations for this user
    const { data: installationsData } = await userOctokit.request('GET /user/installations');
    
    for (const installation of installationsData.installations) {
      const installationId = installation.id;
      const octokit = await app.getInstallationOctokit(installationId);
      
      const { data: repos } = await octokit.request('GET /installation/repositories');

      for (const repo of repos.repositories) {
        await db.query(
          `INSERT INTO repositories (owner, repo, installation_id)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [repo.owner.login, repo.name, String(installationId)]
        );
      }
    }

    return Response.redirect(new URL('/dashboard', request.url));

  } catch (err) {
    return Response.json({ 
      error: err.message,
      stack: err.stack 
    }, { status: 500 });
  }
}