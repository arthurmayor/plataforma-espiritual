const env = require('../config/env');
const logger = require('../utils/logger');

async function generateSpeech(text) {
  const apiKey = env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY not configured');

  const voiceId = env.ELEVENLABS_VOICE_ID;
  const model = env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: model,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ElevenLabs error ${res.status}: ${body}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  logger.info('tts: audio generated', { bytes: arrayBuffer.byteLength });
  return Buffer.from(arrayBuffer);
}

module.exports = { generateSpeech };
