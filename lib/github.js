import { App } from '@octokit/app';
import { Octokit } from '@octokit/rest';

let app;

function getApp() {
  if (!app) {
    app = new App({
      appId: process.env.GITHUB_APP_ID,
      privateKey: process.env.GITHUB_PRIVATE_KEY.replace(/\\n/g, '\n'),
    });
  }
  return app;
}

export async function getInstallationOctokit(installationId) {
  const appOctokit = await getApp().getInstallationOctokit(installationId);
  const { token } = await appOctokit.auth({ type: 'installation' });
  return new Octokit({ auth: token });
}

export async function getAuthenticatedOctokit(token) {
  return new Octokit({ auth: token });
}

export { getApp };