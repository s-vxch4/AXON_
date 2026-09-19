export async function sendSlackAlert(pr, apiName, affectedFile, confidenceScore) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  let payload;

  if (pr) {
    payload = {
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Axon — Fix PR opened*\n*API:* \`${apiName}\`\n*File:* \`${affectedFile}\`\n*Confidence:* ${confidenceScore}%\n*PR:* <${pr.html_url}|View PR>`,
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
    };
  } else {
    payload = {
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Axon — Fix pipeline failed*\n*API:* \`${apiName}\`\n*File:* \`${affectedFile}\`\nAn error occurred during the fix pipeline. Manual intervention required.`,
          },
        },
      ],
    };
  }

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
