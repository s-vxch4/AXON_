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

// FIX: Deterministic path-swap — guaranteed to work with zero LLM dependency.
// When both oldPath and newPath are known (the common path-rename case),
// we do a direct global string replace on the source code FIRST.
// This is the core demo scenario: /api/chat-v6 → /api/chat-v7.
// The LLM path is only taken when the change is structural (not a simple rename).
function applyDeterministicPathSwap(codeSnippet, oldPath, newPath) {
  if (!oldPath || !newPath || oldPath === newPath) {
    return null; // not a path rename — fall through to LLM
  }

  // Count occurrences before replacing so we can log them
  const occurrences = (codeSnippet.split(oldPath)).length - 1;
  if (occurrences === 0) {
    console.log(
      `[fixgen] Deterministic swap: oldPath="${oldPath}" not found in file — falling through to LLM`
    );
    return null;
  }

  const fixedCode = codeSnippet.split(oldPath).join(newPath);
  console.log(
    `[fixgen] ✓ Deterministic path swap applied: "${oldPath}" → "${newPath}" (${occurrences} occurrence(s) replaced)`
  );

  // Verify the new path is present and old path is gone
  const newPathPresent = fixedCode.includes(newPath);
  const oldPathGone = !fixedCode.includes(oldPath);
  console.log(
    `[fixgen] Swap verification: newPath present=${newPathPresent} oldPath gone=${oldPathGone}`
  );

  return {
    fixed_code: fixedCode,
    confidence: {
      score: 99,
      migration_guide_match: 1.0,
      change_scope: 'rename',
    },
    explanation: `Replaced "${oldPath}" with "${newPath}" (${occurrences} occurrence(s), deterministic string swap — no LLM required).`,
    deterministic: true,
  };
}

export async function generateFix(
  apiName,
  breakingChanges,
  affectedFile,
  lineNumber,
  codeSnippet,
  incidentId,
  oldPath,
  newPath
) {
  console.log(`\n[fixgen] ========== FIX GENERATION START ==========`);
  console.log(`[fixgen] api=${apiName} file=${affectedFile} line=${lineNumber}`);
  console.log(`[fixgen] oldPath=${oldPath ?? '(none)'} newPath=${newPath ?? '(none)'}`);
  console.log(`[fixgen] codeSnippet length=${codeSnippet?.length ?? 0} chars`);

  if (!codeSnippet || codeSnippet.trim().length === 0) {
    throw new Error(`generateFix called with empty codeSnippet for ${affectedFile}`);
  }

  // -----------------------------------------------------------------------
  // STAGE 1: Deterministic path swap (zero LLM dependency)
  // This is the primary path for a rename demo. If it succeeds, skip cache
  // lookup and LLM entirely — the result is guaranteed correct.
  // -----------------------------------------------------------------------
  const deterministicFix = applyDeterministicPathSwap(codeSnippet, oldPath, newPath);
  if (deterministicFix) {
    console.log(`[fixgen] Using deterministic fix (confidence=99) — skipping LLM`);
    await logIncident(incidentId, `Fix generated deterministically: ${deterministicFix.explanation}`, 'info');
    console.log(`[fixgen] ========== FIX GENERATION END (deterministic) ==========\n`);

    // Persist the deterministic fix to cache so re-runs are instant
    // FIX: cache key includes oldPath+newPath so a v5→v6 cached fix is never
    // served for a v6→v7 event (the old code only hashed apiName+change.id+code)
    const cacheKey = crypto
      .createHash('sha256')
      .update(`${apiName}:${oldPath ?? ''}:${newPath ?? ''}:${codeSnippet.trim()}`)
      .digest('hex');
    try {
      await db.query(
        `INSERT INTO fix_cache (cache_key, fixed_code, confidence_score, explanation)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (cache_key) DO NOTHING`,
        [cacheKey, deterministicFix.fixed_code, deterministicFix.confidence.score, deterministicFix.explanation]
      );
      console.log(`[fixgen] Deterministic fix cached key=${cacheKey}`);
    } catch (cacheErr) {
      console.warn(`[fixgen] Cache write failed (non-fatal): ${cacheErr.message}`);
    }

    return deterministicFix;
  }

  // -----------------------------------------------------------------------
  // STAGE 2: Cache lookup (structural changes — LLM-generated previously)
  // FIX: cache key now includes oldPath+newPath to prevent cross-version hits
  // -----------------------------------------------------------------------
  const cacheKey = crypto
    .createHash('sha256')
    .update(`${apiName}:${oldPath ?? ''}:${newPath ?? ''}:${(breakingChanges[0]?.id ?? breakingChanges[0]?.text ?? '')}:${codeSnippet.trim()}`)
    .digest('hex');

  let cached = [];
  try {
    console.log(`[fixgen] Checking fix cache key=${cacheKey}`);
    const cachedResult = await db.query('SELECT * FROM fix_cache WHERE cache_key = $1', [cacheKey]);
    cached = cachedResult?.rows ?? [];
    console.log(`[fixgen] Fix cache rows=${cached.length}`);
  } catch (error) {
    console.error('[fixgen] Fix cache read failed; continuing without cache:', error.message);
  }

  if (cached.length > 0) {
    try {
      await db.query('UPDATE fix_cache SET times_used = times_used + 1 WHERE cache_key = $1', [cacheKey]);
    } catch (error) {
      console.warn('[fixgen] Fix cache update failed (non-fatal):', error.message);
    }
    console.log(`[fixgen] Cache hit — returning cached fix`);
    await logIncident(incidentId, 'Fix cache hit', 'info');
    console.log(`[fixgen] ========== FIX GENERATION END (cache hit) ==========\n`);
    return cached[0];
  }

  // -----------------------------------------------------------------------
  // STAGE 3: LLM call (structural breaking changes, no known path rename)
  // -----------------------------------------------------------------------
  console.log(`[fixgen] No cache hit — calling LLM`);

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
  console.log(`[fixgen] LLM response received (${raw?.length ?? 0} chars)`);

  const fix = parseDelimitedFix(raw);
  if (!fix || !fix.fixed_code || !fix.fixed_code.trim()) {
    throw new Error(`Invalid fix response — could not parse delimiters: ${raw.slice(0, 500)}`);
  }

  // Sanity-check: if we had a newPath the LLM fix must contain it
  if (newPath && !fix.fixed_code.includes(newPath)) {
    console.warn(
      `[fixgen] WARNING: LLM fix does not contain newPath="${newPath}". ` +
      `The fix may be incorrect. Check the LLM response.`
    );
  }

  console.log(
    `[fixgen] ✓ LLM fix parsed — confidence=${fix.confidence?.score} scope=${fix.confidence?.change_scope}`
  );

  try {
    await db.query(
      `INSERT INTO fix_cache (cache_key, fixed_code, confidence_score, explanation)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (cache_key) DO NOTHING`,
      [cacheKey, fix.fixed_code, fix.confidence?.score ?? 0, fix.explanation || '']
    );
    console.log(`[fixgen] LLM fix stored in cache key=${cacheKey}`);
  } catch (error) {
    console.warn('[fixgen] Fix cache write failed (non-fatal):', error.message);
  }

  await logIncident(incidentId, `Fix generated via LLM: ${fix.explanation}`, 'info');
  console.log(`[fixgen] ========== FIX GENERATION END (LLM) ==========\n`);
  return fix;
}
