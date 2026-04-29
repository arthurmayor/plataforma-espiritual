function log(level, msg, data) {
  const entry = { level, time: new Date().toISOString(), msg };
  if (data instanceof Error) {
    entry.error = { message: data.message, stack: data.stack };
  } else if (data !== undefined) {
    entry.data = data;
  }
  console.log(JSON.stringify(entry));
}

module.exports = {
  info: (msg, data) => log('info', msg, data),
  warn: (msg, data) => log('warn', msg, data),
  error: (msg, data) => log('error', msg, data),
};
