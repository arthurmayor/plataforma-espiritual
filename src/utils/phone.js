const logger = require('./logger');

function normalizePhone(phone) {
  if (!phone) return null;
  let digits = String(phone).replace(/\D/g, '');

  // Already includes country code 55
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    return '+' + digits;
  }

  // Remove leading zero (e.g. 011...)
  if (digits.startsWith('0')) {
    digits = digits.substring(1);
  }

  // National number with 10 or 11 digits
  if (digits.length === 10 || digits.length === 11) {
    return '+55' + digits;
  }

  return null;
}

function isValidBrazilianPhone(phone) {
  if (!phone) return false;
  const match = phone.match(/^\+55(\d{10,11})$/);
  if (!match) return false;

  // 10 national digits may be a landline — log warning but don't block
  if (match[1].length === 10) {
    logger.warn('Phone number may be a landline (10 national digits)', { phone });
  }

  return true;
}

module.exports = { normalizePhone, isValidBrazilianPhone };
