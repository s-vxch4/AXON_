import crypto from 'crypto';
import { db } from './db.js';
import { callLLM } from './llm.js';
import { logIncident } from './logger.js';

function parseDelimitedFix(raw) {
  const codeMatch = raw.match(/---FIXED_CODE_START---([\s\S]*?)---FIXED_CODE_END---/);
  const scoreMatch = raw.match(/---CONFIDENCE_SCORE---\s*(\d+)/);
  const migrationMatch = raw.match(/---MIGRATION_MATCH---\s*([\d.]+)/);
  const scopeMatch = raw.match(/---CHANGE_SCOPE---\s*(\w+)/);
  const explanationMatch = raw.match(/---EXPLANATION---([\s\S]*?)---END---/);

  if (!codeMatch) {
    return null;
  }

  return {
    fixed_code: codeMatch[1].replace(/^\n/, '').replace(/\n$/, ''),
    confidence: {
      score: scoreMatch ? parseInt(scoreMatch[1], 10) : 0,
      migration_guide_match: migrationMatch ? parseFloat(migrationMatch[1]) : 0,
      change_scope: scopeMatch ? scopeMatch[1] : 'unknown',
    },
    explanation: explanationMatch ? explanationMatch[1].trim() : '',
  };
}

export async function generateFix(apiName, breakingChanges, affectedFile, lineNumber, codeSnippet, incidentId, oldPath, newPath) {
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
    'You are a precise code fix generator. You output ONLY the exact delimited format requested. No markdown code fences. No commentary before or after. No backticks anywhere in your response.';

  const pathInstruction = (oldPath && newPath)
    ? `The endpoint has been renamed from "${oldPath}" to "${newPath}". Update ONLY the URL string in the fetch/API call from "${oldPath}" to "${newPath}".`
    : `Identify and fix the specific breaking change described below.`;

  const userPrompt = `A third-party API introduced a breaking change.

Breaking change:
${JSON.stringify(breakingChanges, null, 2)}

${pathInstruction}

CRITICAL CONSTRAINTS:
- Make the smallest possible change. Do not rewrite the function.
- Preserve the exact function name, export syntax (e.g. "export async function X"), and parameter names exactly as in the original file.
- Preserve the exact return statement and return type — do not change what the function returns.
- Do not rename, refactor, or restructure anything else in the file.
- Output the FULL corrected file content, not just the changed line.

Full original file content of ${affectedFile}:
${codeSnippet}

Respond in EXACTLY this format, with no deviation, no markdown fences, no extra text:

---FIXED_CODE_START---
<full corrected file content here, raw code, no backticks>
---FIXED_CODE_END---
---CONFIDENCE_SCORE---
<integer 0-100>
---MIGRATION_MATCH---
<float 0.0-1.0>
---CHANGE_SCOPE---
<rename OR endpoint_swap OR logic_restructure>
---EXPLANATION---
<one sentence explanation>
---END---`;

  const raw = await callLLM([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]);
  console.log('[fixgen] LLM response received');

  const fix = parseDelimitedFix(raw);
  if (!fix || !fix.fixed_code || !fix.fixed_code.trim()) {
    throw new Error(`Invalid fix response, could not parse delimiters: ${raw.slice(0, 500)}`);
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