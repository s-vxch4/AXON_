import crypto from 'crypto';
import { db } from './db.js';
import { callLLM } from './llm.js';
import { extractJSON } from './utils.js';
import { logIncident } from './logger.js';

export async function generateFix(apiName, breakingChanges, affectedFile, lineNumber, codeSnippet, incidentId) {
  const cacheKey = crypto
    .createHash('sha256')
    .update(`${apiName}:${breakingChanges[0].id}:${codeSnippet.trim()}`)
    .digest('hex');

  const cached = await db.query(
    'SELECT * FROM fix_cache WHERE cache_key = $1',
    [cacheKey]
  );

  if (cached && cached.length > 0) {
    await db.query(
      'UPDATE fix_cache SET times_used = times_used + 1 WHERE cache_key = $1',
      [cacheKey]
    );
    await logIncident(incidentId, `Cache hit for fix: ${affectedFile}:${lineNumber}`, 'info');
    return cached[0];
  }

  const systemPrompt =
    'You are a code fix generator. Respond with only valid JSON. No explanation. No markdown. No backticks.';

  const userPrompt = `Breaking change detected in API: ${apiName}

Breaking changes JSON:
${JSON.stringify(breakingChanges, null, 2)}

Affected code:
File: ${affectedFile}
Line: ${lineNumber}

Code:
${codeSnippet}

Generate a fix for the affected code. Return JSON with these fields:
{
  "fixed_code": "the corrected code as a string",
  "confidence": {
    "migration_guide_match": 0.0-1.0,
    "change_scope": "string describing scope",
    "score": integer 0-100
  },
  "explanation": "string explaining the fix"
}`;

  const raw = await callLLM([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]);

  const fix = extractJSON(raw);
  const fixObj = Array.isArray(fix) ? fix[0] : fix;

  await db.query(
    `INSERT INTO fix_cache (cache_key, fixed_code, confidence_score, explanation)
     VALUES ($1, $2, $3, $4)`,
    [
      cacheKey,
      fixObj.fixed_code,
      fixObj.confidence?.score ?? 0,
      fixObj.explanation || '',
    ]
  );

  await logIncident(incidentId, `Fix generated for ${affectedFile}:${lineNumber}`, 'info');
  return fixObj;
}
