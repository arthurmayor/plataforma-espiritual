const { Router } = require('express');
const supabase = require('../config/supabase');
const { uploadFile, getPublicUrl } = require('../config/supabase');
const env = require('../config/env');
const whatsapp = require('../services/whatsapp');
const { generateDailyMessage, formatTextForAudio } = require('../services/llm');
const { generateSpeech } = require('../services/tts');
const { mixVoiceWithMusic, ensureBackgroundMusic } = require('../services/audio-mixer');
const logger = require('../utils/logger');

const router = Router();

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Whole-day difference between two YYYY-MM-DD dates (UTC).
function daysBetween(startDateStr, todayStr) {
  const start = Date.parse(`${startDateStr}T00:00:00Z`);
  const today = Date.parse(`${todayStr}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(today)) return null;
  return Math.round((today - start) / MS_PER_DAY);
}

// Generate voice -> mix with music -> upload -> send WhatsApp audio.
// Falls back to plain text if any audio step fails. Returns true if anything was sent.
async function synthesizeAndSend(deliveryId, text, phoneE164) {
  let audioSent = false;

  if (env.ELEVENLABS_API_KEY) {
    try {
      const audioText = formatTextForAudio(text);
      let audioBuffer = await generateSpeech(audioText);

      try {
        const musicPath = await ensureBackgroundMusic();
        audioBuffer = await mixVoiceWithMusic(audioBuffer, musicPath);
      } catch (mixErr) {
        logger.warn('scheduler: mix failed, using voice-only audio', { error: mixErr.message });
      }

      const storagePath = `daily-messages/${deliveryId}.mp3`;
      await uploadFile('audios', storagePath, audioBuffer, 'audio/mpeg');
      const audioUrl = getPublicUrl('audios', storagePath);

      await supabase.from('content_deliveries')
        .update({ audio_url: audioUrl, content_type: 'audio' })
        .eq('id', deliveryId);

      await whatsapp.sendAudio(phoneE164, audioUrl);
      audioSent = true;
      logger.info('scheduler: audio sent', { deliveryId, audioUrl });
    } catch (audioErr) {
      logger.warn('scheduler: audio path failed, falling back to text', { deliveryId, error: audioErr.message });
    }
  }

  if (!audioSent) {
    await whatsapp.sendText(phoneE164, text);
    logger.info('scheduler: text sent (fallback)', { deliveryId });
  }
  return true;
}

// Process a single profile's daily message. Resilient — throws only to be caught by caller.
async function processProfile(profile, prefByProfile, todayStr) {
  const dayNumber = daysBetween(profile.sequence_start_date, todayStr);

  if (dayNumber === null || dayNumber < 1 || dayNumber > 7) {
    return 'skipped'; // outside the D1–D7 window
  }

  // idempotency: already delivered this day_number?
  const { data: existing } = await supabase
    .from('content_deliveries')
    .select('id')
    .eq('profile_id', profile.id)
    .eq('day_number', dayNumber)
    .maybeSingle();

  if (existing) return 'skipped';

  // themes/scriptures already used in earlier days (avoid repetition)
  const { data: prior } = await supabase
    .from('content_deliveries')
    .select('theme, scripture_ref, day_number')
    .eq('profile_id', profile.id)
    .not('theme', 'is', null)
    .order('day_number', { ascending: true });

  const recentThemes = (prior || [])
    .map((d) => {
      const ref = d.scripture_ref ? ` (passagem: ${d.scripture_ref})` : '';
      return `Dia ${d.day_number}: ${d.theme}${ref}`;
    });

  const prefs = prefByProfile[profile.id] || {};
  const context = {
    userName: profile.full_name,
    emotionalState: prefs.emotional_state,
    painPoint: prefs.pain_point,
    tonePreference: prefs.tone_preference,
  };

  // create the delivery row (pending) so we have an id for storage + tracking
  const { data: delivery, error: insertErr } = await supabase
    .from('content_deliveries')
    .insert({
      profile_id: profile.id,
      status: 'pending',
      day_number: dayNumber,
      input_context: { day_number: dayNumber, ...prefs },
    })
    .select('id')
    .single();

  if (insertErr) throw new Error(`insert delivery failed: ${insertErr.message}`);
  const deliveryId = delivery.id;

  try {
    const { text, theme, scripture_ref } = await generateDailyMessage(context, dayNumber, recentThemes);

    await supabase.from('content_deliveries')
      .update({ generated_text: text, theme, scripture_ref })
      .eq('id', deliveryId);

    await synthesizeAndSend(deliveryId, text, profile.phone_e164);

    await supabase.from('content_deliveries')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', deliveryId);

    return 'sent';
  } catch (err) {
    await supabase.from('content_deliveries')
      .update({ status: 'failed', error_message: err.message })
      .eq('id', deliveryId);
    throw err;
  }
}

router.post('/scheduler/run', async (req, res) => {
  // ── auth ──────────────────────────────────────────────────────────────────
  if (!env.SCHEDULER_SECRET) {
    logger.error('scheduler: SCHEDULER_SECRET not configured');
    return res.status(500).json({ success: false, error: 'Scheduler not configured' });
  }
  if (req.get('x-scheduler-key') !== env.SCHEDULER_SECRET) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  // only consider cycles that could still be inside the 7-day window
  const cutoff = new Date(Date.now() - 8 * MS_PER_DAY).toISOString().slice(0, 10);

  // ── a: eligible profiles ────────────────────────────────────────────────────
  const { data: profiles, error: profErr } = await supabase
    .from('profiles')
    .select('id, full_name, phone_e164, sequence_start_date, opt_in_whatsapp, plan_status')
    .eq('plan_status', 'free')
    .eq('opt_in_whatsapp', true)
    .not('sequence_start_date', 'is', null)
    .gte('sequence_start_date', cutoff);

  if (profErr) {
    logger.error('scheduler: failed to load profiles', profErr);
    return res.status(500).json({ success: false, error: 'Database error' });
  }

  const summary = { processed: 0, sent: 0, skipped: 0, failed: 0 };

  if (!profiles || profiles.length === 0) {
    return res.status(200).json({ success: true, ...summary });
  }

  // batch-load preferences for all profiles
  const ids = profiles.map((p) => p.id);
  const { data: prefs } = await supabase
    .from('user_preferences')
    .select('profile_id, emotional_state, pain_point, tone_preference')
    .in('profile_id', ids);

  const prefByProfile = {};
  (prefs || []).forEach((p) => { prefByProfile[p.profile_id] = p; });

  // ── b/c: process each profile resiliently ───────────────────────────────────
  for (const profile of profiles) {
    summary.processed += 1;
    try {
      const outcome = await processProfile(profile, prefByProfile, todayStr);
      if (outcome === 'sent') summary.sent += 1;
      else summary.skipped += 1;
    } catch (err) {
      summary.failed += 1;
      logger.error('scheduler: profile failed', { profileId: profile.id, error: err.message });
    }
  }

  logger.info('scheduler: run complete', summary);
  return res.status(200).json({ success: true, ...summary });
});

module.exports = router;
