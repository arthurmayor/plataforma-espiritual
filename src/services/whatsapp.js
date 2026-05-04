const twilio = require('twilio');
const env = require('../config/env');
const logger = require('../utils/logger');

function getClient() {
  return twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
}

function fromWhatsApp(whatsappNumber) {
  return String(whatsappNumber).replace(/^whatsapp:/, '');
}

function toWhatsApp(phoneE164) {
  return `whatsapp:${phoneE164}`;
}

async function sendText(to, text) {
  const from = toWhatsApp(env.TWILIO_PHONE_NUMBER);
  const toFormatted = toWhatsApp(to);

  if (to === env.TWILIO_PHONE_NUMBER || toFormatted === from) {
    logger.warn('Attempted to send message to own Twilio number — skipped', { to });
    return null;
  }

  const message = await getClient().messages.create({
    from,
    to: toFormatted,
    body: text,
  });

  logger.info('WhatsApp message sent', { sid: message.sid, to });
  return message;
}

async function sendAudio(to, audioUrl) {
  const from = toWhatsApp(env.TWILIO_PHONE_NUMBER);
  const toFormatted = toWhatsApp(to);

  if (to === env.TWILIO_PHONE_NUMBER || toFormatted === from) {
    logger.warn('Attempted to send audio to own Twilio number — skipped', { to });
    return null;
  }

  const message = await getClient().messages.create({
    from,
    to: toFormatted,
    mediaUrl: [audioUrl],
  });

  logger.info('WhatsApp audio sent', { sid: message.sid, to });
  return message;
}

module.exports = { sendText, sendAudio, fromWhatsApp, toWhatsApp };
