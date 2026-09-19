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
    if (!canCall(provider)) {
      console.log(`[${provider.name}] RPM limit reached, trying next...`);
      continue;
    }

    try {
      const res = await fetch(provider.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify({
          model: provider.model,
          messages,
          max_tokens: 1500,
          temperature: 0,
        }),
      });

      if (res.status === 429) {
        console.log(`[${provider.name}] 429 — trying next...`);
        continue;
      }

      if (!res.ok) {
        console.log(`[${provider.name}] ${res.status} — trying next...`);
        continue;
      }

      const data = await res.json();
      recordCall(provider.name);
      console.log(`[${provider.name}] \u2713`);
      return data.choices[0].message.content;
    } catch (err) {
      console.log(`[${provider.name}] ${err.message} — trying next...`);
      continue;
    }
  }

  throw new Error('All LLM providers exhausted.');
}
