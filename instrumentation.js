export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Cron disabled for demo stability — webhook is the live trigger path.
    // const { startCron } = await import('./lib/cron.js');
    // startCron();
  }
}