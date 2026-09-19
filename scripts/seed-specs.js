import { storeSpecBaseline } from '../lib/specs.js';

const specs = [
  { name: 'stripe', url: 'https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json' },
  { name: 'twilio', url: 'https://raw.githubusercontent.com/twilio/twilio-oai/main/spec/yaml/twilio_api_v2010.yaml' },
  { name: 'sendgrid', url: 'https://raw.githubusercontent.com/twilio/sendgrid-oai/main/oai.yaml' },
  { name: 'openai', url: 'https://raw.githubusercontent.com/openai/openai-openapi/master/openapi.yaml' },
  { name: 'github', url: 'https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json' },
  { name: 'supportiq', url: 'https://raw.githubusercontent.com/s-vxch4/supportiq/main/openapi.yaml' },
];

async function run() {
  for (const spec of specs) {
    try {
      console.log(`[seed] storing ${spec.name}...`);
      await storeSpecBaseline(spec.name, spec.url);
      console.log(`[seed] ${spec.name} done`);
    } catch (err) {
      console.error(`[seed] ${spec.name} failed:`, err.message);
    }
  }
  console.log('[seed] all specs stored');
}

run();