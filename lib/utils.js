export function extractJSON(raw) {
  try {
    return JSON.parse(raw);
  } catch {}

  try {
    const match = raw.match(/\[[\s\S]*\]/);
    if (match) {
      return JSON.parse(match[0]);
    }
  } catch {}

  console.warn('extractJSON: failed to parse JSON. First 200 chars:', String(raw).slice(0, 200));
  return [];
}
