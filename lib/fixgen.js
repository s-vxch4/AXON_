import crypto from 'crypto';
import { db } from './db.js';
import { callLLM } from './llm.js';
import { extractJSON } from './utils.js';
import { logIncident } from './logger.js';

export async function generateFix(apiName, breakingChanges, affectedFile, lineNumber, codeSnippet, incidentId) {
  const cacheKey = crypto
    .createHash('sha256')
    .update(`${apiName}:${breakingChanges[0]?.id ?? breakingChanges[0]?.text}:${codeSnippet.trim()}`)
    .digest('hex');

  let cached = [];
  try {
    console.log(`[fixgen] Checking fix cache key=${cacheKey}`);
    const cachedResult = await db.query(
      'SELECT * FROM fix_cache WHERE cache_key = $1',
      [cacheKey]
    );
    cached = cachedResult?.rows ?? cachedResult;
    console.log(`[fixgen] Fix cache rows=${cached.length}`);
  } catch (error) {
    console.error('[fixgen] Fix cache read failed; continuing without cache:', error);
  }

  if (cached && cached.length > 0) {
    try {
      await db.query(
        'UPDATE fix_cache SET times_used = times_used + 1 WHERE cache_key = $1',
        [cacheKey]
      );
    } catch (error) {
      console.error('[fixgen] Fix cache update failed:', error);
    }
    await logIncident(incidentId, 'Fix cache hit', 'info');
    return cached[0];
  }

  const systemPrompt =
    'You are a code fix generator. Respond with only valid JSON. No explanation. No markdown. No backticks.';

  const userPrompt = `A third-party API introduced a breaking change.

Breaking change:
${JSON.stringify(breakingChanges, null, 2)}

Affected code in ${affectedFile} at line ${lineNumber}:
${codeSnippet}

Return ONLY this JSON:
{"fixed_code":"<corrected code>","confidence":{"migration_guide_match":<0.0-1.0>,"change_scope":"<rename|endpoint_swap|logic_restructure>","score":<0-100>},"explanation":"<one sentence>"}`;

  const raw = await callLLM([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]);
  console.log('[fixgen] LLM response received');

  const fix = extractJSON(raw);
  if (!fix || Array.isArray(fix) || typeof fix.fixed_code !== 'string' || !fix.fixed_code.trim()) {
    throw new Error(`Invalid fix response: ${JSON.stringify(fix).slice(0, 500)}`);
  }

  try {
    await db.query(
      `INSERT INTO fix_cache (cache_key, fixed_code, confidence_score, explanation)
       VALUES ($1, $2, $3, $4)`,
      [
        cacheKey,
        fix.fixed_code,
        fix.confidence?.score ?? 0,
        fix.explanation || '',
      ]
    );
    console.log(`[fixgen] Stored generated fix cache key=${cacheKey}`);
  } catch (error) {
    console.error('[fixgen] Fix cache write failed; continuing with generated fix:', error);
  }

  return fix;
}
