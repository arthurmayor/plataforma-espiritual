const { Router } = require('express');
const fs = require('fs');
const supabase = require('../config/supabase');
const { uploadFile, getPublicUrl } = require('../config/supabase');
const whatsapp = require('../services/whatsapp');
const { generateFirstMessage, formatTextForAudio } = require('../services/llm');
const { generateSpeech } = require('../services/tts');
const { mixVoiceWithMusic } = require('../services/audio-mixer');
const { normalizePhone, isValidBrazilianPhone } = require('../utils/phone');
const logger = require('../utils/logger');

const BACKGROUND_MUSIC_URL = 'https://dapxhktnsszbqhxyqmde.supabase.co/storage/v1/object/public/audios/music/background.mp3';
const BACKGROUND_MUSIC_PATH = '/tmp/background-music.mp3';

async function ensureBackgroundMusic() {
  if (fs.existsSync(BACKGROUND_MUSIC_PATH)) return;
  logger.info('audio-mixer: downloading background music');
  const res = await fetch(BACKGROUND_MUSIC_URL);
  if (!res.ok) throw new Error(`Failed to download background music: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(BACKGROUND_MUSIC_PATH, buf);
  logger.info('audio-mixer: background music cached', { bytes: buf.length });
}

const router = Router();

router.post('/onboarding', async (req, res) => {
  const { name, phone, emotional_state, pain_point, tone_preference, opt_in_whatsapp } = req.body;

  if (!name || !phone) {
    return res.status(400).json({ success: false, error: 'name and phone are required' });
  }

  const phoneE164 = normalizePhone(phone);
  if (!phoneE164 || !isValidBrazilianPhone(phoneE164)) {
    return res.status(400).json({ success: false, error: 'Invalid Brazilian phone number' });
  }

  // ── a/b/c/d: upsert profile ────────────────────────────────────────────────
  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('phone_e164', phoneE164)
    .maybeSingle();

  let profileId;

  if (existing) {
    const { data, error } = await supabase
      .from('profiles')
      .update({
        full_name: name,
        onboarding_completed: true,
        opt_in_whatsapp: opt_in_whatsapp ?? true,
      })
      .eq('id', existing.id)
      .select('id')
      .single();

    if (error) {
      logger.error('onboarding: failed to update profile', error);
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    profileId = data.id;
  } else {
    const { data, error } = await supabase
      .from('profiles')
      .insert({
        phone_e164: phoneE164,
        full_name: name,
        onboarding_completed: true,
        opt_in_whatsapp: opt_in_whatsapp ?? true,
      })
      .select('id')
      .single();

    if (error) {
      logger.error('onboarding: failed to create profile', error);
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    profileId = data.id;
  }

  // ── e: upsert user_preferences (select-then-insert/update) ────────────────
  const prefPayload = {
    emotional_state: emotional_state || null,
    pain_point: pain_point || null,
    tone_preference: tone_preference || null,
  };

  const { data: existingPref } = await supabase
    .from('user_preferences')
    .select('id')
    .eq('profile_id', profileId)
    .maybeSingle();

  if (existingPref) {
    const { error: prefError } = await supabase
      .from('user_preferences')
      .update(prefPayload)
      .eq('profile_id', profileId);
    if (prefError) logger.error('onboarding: failed to update user_preferences', prefError);
  } else {
    const { error: prefError } = await supabase
      .from('user_preferences')
      .insert({ profile_id: profileId, ...prefPayload });
    if (prefError) logger.error('onboarding: failed to insert user_preferences', prefError);
  }

  // ── f: idempotency — already delivered today ───────────────────────────────
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const { data: existingDelivery } = await supabase
    .from('content_deliveries')
    .select('id')
    .eq('profile_id', profileId)
    .gte('created_at', todayStart.toISOString())
    .maybeSingle();

  if (existingDelivery) {
    logger.info('onboarding: delivery already exists for today', { profileId });
    return res.status(200).json({
      success: true,
      message: 'Já gerada hoje',
      profileId,
      deliveryId: existingDelivery.id,
    });
  }

  // ── g: create content_delivery with status='pending' ──────────────────────
  const inputContext = { name, emotional_state, pain_point, tone_preference, opt_in_whatsapp };

  const { data: delivery, error: deliveryError } = await supabase
    .from('content_deliveries')
    .insert({ profile_id: profileId, status: 'pending', input_context: inputContext })
    .select('id')
    .single();

  if (deliveryError) {
    logger.error('onboarding: failed to create content_delivery', deliveryError);
    return res.status(500).json({ success: false, error: 'Database error' });
  }

  const deliveryId = delivery.id;

  // ── h: return 200 immediately ──────────────────────────────────────────────
  res.status(200).json({ success: true, profileId, deliveryId });

  // ── i: async generation + send ────────────────────────────────────────────
  setImmediate(async () => {
    // a) generate text
    let text;
    try {
      text = await generateFirstMessage({
        userName: name,
        emotionalState: emotional_state,
        painPoint: pain_point,
        tonePreference: tone_preference,
      });
    } catch (err) {
      logger.error('onboarding: text generation failed', err);
      await supabase.from('content_deliveries')
        .update({ status: 'failed', error_message: err.message })
        .eq('id', deliveryId);
      return;
    }

    // b) save generated_text
    await supabase.from('content_deliveries')
      .update({ generated_text: text })
      .eq('id', deliveryId);

    // c–i) try audio path; fall back to text on any failure
    let sent = false;

    logger.info('TTS: starting audio generation');
    logger.info('TTS: ELEVENLABS_API_KEY exists?', { exists: !!process.env.ELEVENLABS_API_KEY });
    logger.info('TTS: ELEVENLABS_VOICE_ID exists?', { exists: !!process.env.ELEVENLABS_VOICE_ID });

    if (process.env.ELEVENLABS_API_KEY) {
      try {
        // c) format for TTS
        const audioText = formatTextForAudio(text);

        // d) generate MP3
        logger.info('TTS: calling generateSpeech', { textLength: audioText.length });
        let audioBuffer = await generateSpeech(audioText);
        logger.info('TTS: speech generated', { bufferSize: audioBuffer?.length });

        // e) mix voice with background music (best-effort — falls back to voice-only)
        try {
          await ensureBackgroundMusic();
          logger.info('audio-mixer: mixing voice with background music');
          audioBuffer = await mixVoiceWithMusic(audioBuffer, BACKGROUND_MUSIC_PATH);
          logger.info('audio-mixer: mix done', { bufferSize: audioBuffer.length });
        } catch (mixErr) {
          logger.warn('audio-mixer: mix failed, using voice-only audio', { error: mixErr.message });
        }

        // f) upload to Supabase Storage
        const storagePath = `first-messages/${deliveryId}.mp3`;
        logger.info('TTS: uploading to Supabase Storage');
        await uploadFile('audios', storagePath, audioBuffer, 'audio/mpeg');

        // g) public URL
        logger.info('TTS: uploaded, getting public URL');
        const audioUrl = getPublicUrl('audios', storagePath);
        logger.info('TTS: public URL obtained', { audioUrl });

        // h) save audio_url
        await supabase.from('content_deliveries')
          .update({ audio_url: audioUrl, content_type: 'audio' })
          .eq('id', deliveryId);

        // i) send audio
        await whatsapp.sendAudio(phoneE164, audioUrl);
        sent = true;
        logger.info('onboarding: audio message sent', { profileId, deliveryId, audioUrl });
      } catch (audioErr) {
        logger.error('TTS: failed at audio generation', { error: audioErr.message, stack: audioErr.stack });
        logger.warn('onboarding: audio path failed, falling back to text', { error: audioErr.message });
      }
    } else {
      logger.warn('TTS: ELEVENLABS_API_KEY not set — skipping audio, sending text');
    }

    // fallback: send text if audio was not sent
    if (!sent) {
      try {
        await whatsapp.sendText(phoneE164, text);
        sent = true;
        logger.info('onboarding: text message sent (fallback)', { profileId, deliveryId });
      } catch (textErr) {
        logger.error('onboarding: text fallback also failed', textErr);
        await supabase.from('content_deliveries')
          .update({ status: 'failed', error_message: textErr.message })
          .eq('id', deliveryId);
        return;
      }
    }

    await supabase.from('content_deliveries')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', deliveryId);
  });
});

module.exports = router;
