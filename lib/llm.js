export const PROVIDERS = [
  {
    name: 'groq',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    apiKey: process.env.GROQ_API_KEY,
    model: 'openai/gpt-oss-120b',
    rpmLimit: 30,
  },
  {
    name: 'openrouter',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    apiKey: process.env.OPENROUTER_API_KEY,
    model: 'openrouter/auto',
    rpmLimit: 20,
  },
  {
    name: 'deepseek',
    url: 'https://api.deepseek.com/chat/completions',
    apiKey: process.env.DEEPSEEK_API_KEY,
    model: 'deepseek-chat',
    rpmLimit: 60,
  },
];

const windowState = {};

export function canCall(provider) {
  const now = Date.now();
  if (!windowState[provider.name]) {
    windowState[provider.name] = { calls: [], windowStart: now };
  }
  const state = windowState[provider.name];
  if (now - state.windowStart > 60000) {
    state.calls = [];
    state.windowStart = now;
  }
  return state.calls.length < provider.rpmLimit;
}

export function recordCall(name) {
  const state = windowState[name];
  if (state) {
    state.calls.push(Date.now());
  }
}

export async function callLLM(messages) {
  for (const provider of PROVIDERS) {
    if (!provider.apiKey) {
      console.log(`[${provider.name}] No API key set, skipping...`);
      continue;
    }

    if (!canCall(provider)) {
      console.log(`[${provider.name}] RPM limit reached, trying next...`);
      continue;
    }

    try {
      // FIX: gpt-oss-120b is a reasoning model — it can consume the entire
      // token budget on internal reasoning and leave content empty.
      // Bumped max_tokens way up and disabled reasoning where the API supports it.
      const body = {
        model: provider.model,
        messages,
        max_tokens: 4096,
        temperature: 0,
      };

      // Groq-specific: force low/no reasoning effort so tokens go to actual output
      if (provider.name === 'groq') {
        body.reasoning_effort = 'low';
      }

      const res = await fetch(provider.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (res.status === 429) {
        console.log(`[${provider.name}] 429 — trying next...`);
        continue;
      }

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.log(`[${provider.name}] ${res.status} — trying next...`, errText.slice(0, 300));
        continue;
      }

      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;

      // FIX: previously this returned even when content was empty/whitespace.
      // Now empty content is treated as a failure and falls through to the next provider.
      if (!content || content.trim().length === 0) {
        console.log(`[${provider.name}] Empty content returned — trying next...`, JSON.stringify(data).slice(0, 500));
        continue;
      }

      recordCall(provider.name);
      console.log(`[${provider.name}] \u2713 (${content.length} chars)`);
      return content;
    } catch (err) {
      console.log(`[${provider.name}] ${err.message} — trying next...`);
      continue;
    }
  }

  throw new Error('All LLM providers exhausted.');
}
