export async function sendSlackAlert(pr, apiName, affectedFile, confidenceScore) {
  try {
    const webhookUrl = process.env.SLACK_WEBHOOK_URL;
    if (!webhookUrl) return;

    const payload = pr
      ? {
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `🚨 *Axon Alert*\n*API:* ${apiName}\n*File:* ${affectedFile}\n*Confidence:* ${confidenceScore}%\n*PR:* <${pr.html_url}|View Fix on GitHub>`,
              },
            },
            {
              type: 'actions',
              elements: [
                {
                  type: 'button',
                  text: { type: 'plain_text', text: 'Review PR' },
                  url: pr.html_url,
                  style: 'primary',
                },
              ],
            },
          ],
        }
      : { text: `🚨 Axon pipeline error for ${apiName}. Manual review required.` };

    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.error('[slack] Failed to send alert:', error);
  }
}
