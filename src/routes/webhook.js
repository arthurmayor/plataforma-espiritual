const { Router } = require('express');
const supabase = require('../config/supabase');
const llm = require('../services/llm');
const whatsapp = require('../services/whatsapp');
const { isValidBrazilianPhone } = require('../utils/phone');
const logger = require('../utils/logger');

const router = Router();
const EMPTY_XML = '<Response></Response>';

function logSupabaseError(msg, err) {
  logger.error(msg, {
    message: err.message,
    code: err.code,
    details: err.details,
    hint: err.hint,
  });
}

router.post('/webhook-whatsapp', async (req, res) => {
  res.set('Content-Type', 'text/xml');

  try {
    const { From, Body, ProfileName, MessageSid } = req.body;
    const phoneE164 = whatsapp.fromWhatsApp(From || '');
    const textBody = (Body || '').trim();

    // [fix-1] Validate Brazilian phone before touching the database
    if (!phoneE164 || !isValidBrazilianPhone(phoneE164)) {
      logger.warn('Invalid WhatsApp From number', { From, phoneE164 });
      return res.status(200).send(EMPTY_XML);
    }

    // Idempotency: skip already-processed messages
    if (MessageSid) {
      const { data: dup } = await supabase
        .from('messages')
        .select('id')
        .eq('provider_message_sid', MessageSid)
        .maybeSingle();

      if (dup) {
        logger.info('Duplicate MessageSid — skipped', { MessageSid });
        return res.status(200).send(EMPTY_XML);
      }
    }

    // Find or create profile
    let { data: profile } = await supabase
      .from('profiles')
      .select('id, full_name, whatsapp_name, denomination, heart_context')
      .eq('phone_e164', phoneE164)
      .maybeSingle();

    if (!profile) {
      const { data: created, error: profileErr } = await supabase
        .from('profiles')
        .insert({ phone_e164: phoneE164, whatsapp_name: ProfileName || null })
        .select('id, full_name, whatsapp_name, denomination, heart_context')
        .single();

      if (profileErr) {
        logSupabaseError('Failed to create profile from webhook', profileErr);
        return res.status(200).send(EMPTY_XML);
      }
      profile = created;
    }

    // Find or create active conversation
    let { data: conversation } = await supabase
      .from('conversations')
      .select('id')
      .eq('profile_id', profile.id)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!conversation) {
      const { data: created, error: convErr } = await supabase
        .from('conversations')
        .insert({ profile_id: profile.id, status: 'active', channel: 'whatsapp' })
        .select('id')
        .single();

      if (convErr) {
        logSupabaseError('Failed to create conversation', convErr);
        return res.status(200).send(EMPTY_XML);
      }
      conversation = created;
    }

    // Handle empty body
    if (!textBody) {
      await supabase.from('messages').insert({
        conversation_id: conversation.id,
        profile_id: profile.id,
        direction: 'inbound',
        role: 'user',
        content_type: 'text',
        text_body: '',
        provider_message_sid: MessageSid || null,
        provider: 'twilio',
        provider_status: 'received',
        raw_payload: req.body,
      });

      try {
        await whatsapp.sendText(
          phoneE164,
          'Por enquanto consigo responder mensagens de texto. Me escreva o que está no seu coração.'
        );
      } catch (err) {
        logger.error('Failed to send empty-body reply', err);
      }

      // [fix-4] Update last_message_at even for empty-body messages
      await supabase
        .from('conversations')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', conversation.id);

      return res.status(200).send(EMPTY_XML);
    }

    // Save inbound message
    const { error: inboundErr } = await supabase.from('messages').insert({
      conversation_id: conversation.id,
      profile_id: profile.id,
      direction: 'inbound',
      role: 'user',
      content_type: 'text',
      text_body: textBody,
      provider_message_sid: MessageSid || null,
      provider: 'twilio',
      provider_status: 'received',
      raw_payload: req.body,
    });

    if (inboundErr) {
      logSupabaseError('Failed to save inbound message', inboundErr);
      return res.status(200).send(EMPTY_XML);
    }

    // [fix-2] Fetch the last 10 messages in reverse then re-order chronologically
    const { data: history } = await supabase
      .from('messages')
      .select('role, text_body')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: false })
      .limit(10);

    const orderedHistory = (history || []).reverse();

    // Generate AI response
    const aiText = await llm.generatePastoralResponse(textBody, {
      userName: profile.full_name || profile.whatsapp_name || 'amigo',
      denomination: profile.denomination,
      heartContext: profile.heart_context,
      conversationHistory: orderedHistory,
    });

    // Save outbound message as pending
    const { data: outboundMsg, error: outboundErr } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        profile_id: profile.id,
        direction: 'outbound',
        role: 'assistant',
        content_type: 'text',
        text_body: aiText,
        provider: 'twilio',
        provider_status: 'pending',
      })
      .select('id')
      .single();

    if (outboundErr) {
      logSupabaseError('Failed to save outbound message', outboundErr);
      return res.status(200).send(EMPTY_XML);
    }

    // [fix-3] Send via WhatsApp — guard against null/missing SID
    try {
      const sent = await whatsapp.sendText(phoneE164, aiText);

      if (!sent || !sent.sid) {
        logger.error('Failed to send WhatsApp message', {
          message: 'Twilio sendText returned no SID',
          phoneE164,
        });
        await supabase
          .from('messages')
          .update({ provider_status: 'failed', error_message: 'Twilio sendText returned no SID' })
          .eq('id', outboundMsg.id);
      } else {
        await supabase
          .from('messages')
          .update({ provider_message_sid: sent.sid, provider_status: 'sent' })
          .eq('id', outboundMsg.id);
      }
    } catch (sendErr) {
      logger.error('Failed to send WhatsApp message', sendErr);
      await supabase
        .from('messages')
        .update({ provider_status: 'failed', error_message: sendErr.message })
        .eq('id', outboundMsg.id);
    }

    // Update conversation timestamp
    await supabase
      .from('conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', conversation.id);

    return res.status(200).send(EMPTY_XML);
  } catch (err) {
    logger.error('Unhandled webhook error', err);
    return res.status(200).send(EMPTY_XML);
  }
});

module.exports = router;
