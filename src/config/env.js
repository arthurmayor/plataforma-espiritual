require('dotenv').config();

const REQUIRED = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_PHONE_NUMBER',
  'ANTHROPIC_API_KEY',
];

function validate() {
  const missing = REQUIRED.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error('[env] Missing required environment variables:');
    missing.forEach((key) => console.error(`  - ${key}`));
    process.exit(1);
  }
}

module.exports = {
  validate,
  get SUPABASE_URL() { return process.env.SUPABASE_URL; },
  get SUPABASE_SERVICE_ROLE_KEY() { return process.env.SUPABASE_SERVICE_ROLE_KEY; },
  get TWILIO_ACCOUNT_SID() { return process.env.TWILIO_ACCOUNT_SID; },
  get TWILIO_AUTH_TOKEN() { return process.env.TWILIO_AUTH_TOKEN; },
  get TWILIO_PHONE_NUMBER() { return process.env.TWILIO_PHONE_NUMBER; },
  get ANTHROPIC_API_KEY() { return process.env.ANTHROPIC_API_KEY; },
  get PORT() { return process.env.PORT || 3000; },
  get ELEVENLABS_API_KEY() { return process.env.ELEVENLABS_API_KEY; },
  get ELEVENLABS_VOICE_ID() { return process.env.ELEVENLABS_VOICE_ID; },
  get ELEVENLABS_MODEL() { return process.env.ELEVENLABS_MODEL || 'eleven_v3'; },
};
