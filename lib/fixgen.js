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

  const cachedResult = await db.query(
    'SELECT * FROM fix_cache WHERE cache_key = $1',
    [cacheKey]
  );
  const cached = cachedResult?.rows ?? cachedResult;

  if (cached && cached.length > 0) {
    await db.query(
      'UPDATE fix_cache SET times_used = times_used + 1 WHERE cache_key = $1',
      [cacheKey]
    );
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

  const fix = extractJSON(raw);

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

  return fix;
}
