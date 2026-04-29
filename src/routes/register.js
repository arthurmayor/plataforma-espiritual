const { Router } = require('express');
const supabase = require('../config/supabase');
const whatsapp = require('../services/whatsapp');
const { normalizePhone, isValidBrazilianPhone } = require('../utils/phone');
const logger = require('../utils/logger');

const router = Router();

router.post('/register', async (req, res) => {
  const { name, phone, denomination, heart_context } = req.body;

  if (!name || !phone) {
    return res.status(400).json({ success: false, error: 'name and phone are required' });
  }

  const phoneE164 = normalizePhone(phone);
  if (!phoneE164 || !isValidBrazilianPhone(phoneE164)) {
    return res.status(400).json({ success: false, error: 'Invalid Brazilian phone number' });
  }

  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('phone_e164', phoneE164)
    .maybeSingle();

  let profileId;

  if (existing) {
    const updates = { full_name: name, updated_at: new Date().toISOString() };
    if (denomination) updates.denomination = denomination;
    if (heart_context) updates.heart_context = heart_context;

    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', existing.id)
      .select('id')
      .single();

    if (error) {
      logger.error('Failed to update profile', error);
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    profileId = data.id;
  } else {
    const insert = { phone_e164: phoneE164, full_name: name, onboarding_completed: true };
    if (denomination) insert.denomination = denomination;
    if (heart_context) insert.heart_context = heart_context;

    const { data, error } = await supabase
      .from('profiles')
      .insert(insert)
      .select('id')
      .single();

    if (error) {
      logger.error('Failed to create profile', error);
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    profileId = data.id;
  }

  // Welcome message — failure does not fail the registration
  try {
    await whatsapp.sendText(
      phoneE164,
      `Olá, ${name}! Sou seu companheiro de oração aqui no WhatsApp. Pode me contar o que está no seu coração — estou ouvindo.`
    );
  } catch (err) {
    logger.error('Failed to send welcome WhatsApp message', err);
  }

  logger.info('Profile registered', { profileId, phoneE164 });
  return res.status(200).json({ success: true, profileId });
});

module.exports = router;
