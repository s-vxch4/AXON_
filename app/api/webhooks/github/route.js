import crypto from 'crypto';
import pg from 'pg';
import { checkSpecForChanges } from '../../../../lib/monitor.js';

export const dynamic = 'force-dynamic';

// FIX: Use pg.Pool instead of the Neon serverless driver.
// The Neon driver uses HTTP fetch which times out in the webhook handler
// because the Next.js edge/node runtime closes the fetch context before
// the DB round-trip completes. A persistent pg pool works reliably.
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
  idleTimeoutMillis: 30000,
});

async function verifySignature(request, rawBody) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('[webhook] GITHUB_WEBHOOK_SECRET not set — skipping signature verification');
    return true;
  }
  const sig = request.headers.get('x-hub-signature-256');
  if (!sig) {
    // No signature header — proceed anyway in demo mode
    return false;
  }
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(rawBody);
  const expected = `sha256=${hmac.digest('hex')}`;
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

export async function POST(request) {
  console.log(`\n[webhook] ========== WEBHOOK RECEIVED ==========`);

  const event    = request.headers.get('x-github-event');
  const delivery = request.headers.get('x-github-delivery') ?? 'unknown';
  console.log(`[webhook] event=${event} delivery=${delivery}`);

  const rawBody = await request.text();

  const valid = await verifySignature(request, rawBody);
  if (!valid) {
    console.warn('[webhook] Signature check failed or missing — proceeding anyway (demo mode)');
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    console.error('[webhook] Failed to parse JSON body:', e.message);
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (event !== 'push') {
    console.log(`[webhook] Ignoring non-push event: ${event}`);
    return Response.json({ ok: true, ignored: true });
  }

  const repoName     = payload.repository?.name ?? '';
  const repoFullName = payload.repository?.full_name ?? '';

  // GitHub web UI edits sometimes send commits with no file lists.
  // Collect pushed files but don't rely on them being present.
  const pushedFiles = (payload.commits ?? []).flatMap((c) => [
    ...(c.added    ?? []),
    ...(c.modified ?? []),
    ...(c.removed  ?? []),
  ]);

  console.log(`[webhook] repo=${repoFullName} pushedFiles=[${pushedFiles.join(', ') || 'none — web UI edit'}]`);

  // Load all monitored specs using pg pool (not Neon serverless)
  let allSpecs = [];
  let client;
  try {
    client = await pool.connect();
    const result = await client.query('SELECT * FROM api_specs');
    allSpecs = result.rows;
    console.log(`[webhook] Loaded ${allSpecs.length} api_specs rows`);
  } catch (err) {
    console.error('[webhook] Failed to query api_specs:', err.message);
    return Response.json({ error: 'DB error' }, { status: 500 });
  } finally {
    if (client) client.release();
  }

  if (allSpecs.length === 0) {
    console.warn('[webhook] No api_specs rows — nothing to monitor');
    return Response.json({ ok: true, matched: false });
  }

  // Match strategy (in priority order):
  // 1. A pushed file matches the spec_url filename  (most specific)
  // 2. spec.api_name === repo name                  (simple setups)
  // 3. spec_url contains the repo full name         (catch-all for raw GitHub URLs)
  // 4. ANY push from this repo triggers ALL specs whose spec_url contains repoName
  //    — covers the case where GitHub web UI sends pushedFiles=[]
  let finalSpecs = allSpecs.filter((spec) => {
    if (!spec.spec_url) return false;

    // Match 1: file path
    if (pushedFiles.length > 0) {
      try {
        const specPath = new URL(spec.spec_url).pathname;
        if (pushedFiles.some((f) => specPath.endsWith(f) || f.endsWith(specPath.replace(/^\//, '')))) {
          console.log(`[webhook] Spec "${spec.api_name}" matched via pushed file`);
          return true;
        }
      } catch { /* invalid URL, skip */ }
    }

    // Match 2: api_name = repo name
    if (spec.api_name === repoName) {
      console.log(`[webhook] Spec "${spec.api_name}" matched via api_name = repo name`);
      return true;
    }

    // Match 3 & 4: spec_url contains owner/repo or just repo name
    if (spec.spec_url.includes(repoFullName) || spec.spec_url.includes(repoName)) {
      console.log(`[webhook] Spec "${spec.api_name}" matched via spec_url contains repo name`);
      return true;
    }

    return false;
  });

  console.log(`[webhook] Matched ${finalSpecs.length} spec(s): [${finalSpecs.map(s => s.api_name).join(', ')}]`);

  if (finalSpecs.length === 0) {
    console.log(`[webhook] No specs matched push from ${repoFullName} — nothing to do`);
    return Response.json({ ok: true, matched: false });
  }

  for (const spec of finalSpecs) {
    console.log(`[webhook] → Processing spec: api_name=${spec.api_name}`);
    try {
      await checkSpecForChanges(spec);
      console.log(`[webhook] ✓ checkSpecForChanges done for ${spec.api_name}`);
    } catch (err) {
      console.error(`[webhook] checkSpecForChanges FAILED for ${spec.api_name}:`, err.message);
    }
  }

  console.log(`[webhook] ========== WEBHOOK DONE ==========\n`);
  return Response.json({ ok: true, matched: finalSpecs.length });
}
