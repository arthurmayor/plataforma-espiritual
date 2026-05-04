const { Router } = require('express');
const supabase = require('../config/supabase');
const whatsapp = require('../services/whatsapp');
const { generateFirstMessage } = require('../services/llm');
const { normalizePhone, isValidBrazilianPhone } = require('../utils/phone');
const logger = require('../utils/logger');

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
        plan_status: 'free',
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

  // ── e: upsert user_preferences ─────────────────────────────────────────────
  const { error: prefError } = await supabase
    .from('user_preferences')
    .upsert(
      {
        profile_id: profileId,
        emotional_state: emotional_state || null,
        pain_point: pain_point || null,
        tone_preference: tone_preference || null,
      },
      { onConflict: 'profile_id' }
    );

  if (prefError) {
    logger.error('onboarding: failed to upsert user_preferences', prefError);
  }

  // ── f: idempotency — already delivered today ───────────────────────────────
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const { data: existing_delivery } = await supabase
    .from('content_delivery')
    .select('id')
    .eq('profile_id', profileId)
    .gte('created_at', todayStart.toISOString())
    .maybeSingle();

  if (existing_delivery) {
    logger.info('onboarding: delivery already exists for today', { profileId });
    return res.status(200).json({ success: true, message: 'Já gerada hoje', profileId, deliveryId: existing_delivery.id });
  }

  // ── g: create content_delivery with status='pending' ──────────────────────
  const inputContext = { name, emotional_state, pain_point, tone_preference, opt_in_whatsapp };

  const { data: delivery, error: deliveryError } = await supabase
    .from('content_delivery')
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
    try {
      const text = await generateFirstMessage({
        userName: name,
        emotionalState: emotional_state,
        painPoint: pain_point,
        tonePreference: tone_preference,
      });

      await supabase
        .from('content_delivery')
        .update({ generated_text: text })
        .eq('id', deliveryId);

      await whatsapp.sendText(phoneE164, text);

      await supabase
        .from('content_delivery')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', deliveryId);

      logger.info('onboarding: first message sent', { profileId, deliveryId });
    } catch (err) {
      logger.error('onboarding: async generation/send failed', err);

      await supabase
        .from('content_delivery')
        .update({ status: 'failed', error_message: err.message })
        .eq('id', deliveryId);
    }
  });
});

module.exports = router;
