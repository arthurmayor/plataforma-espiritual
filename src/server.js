const express = require('express');
const cors = require('cors');
const env = require('./config/env');
const logger = require('./utils/logger');

env.validate();

const registerRouter = require('./routes/register');
const webhookRouter = require('./routes/webhook');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'plataforma-espiritual', timestamp: new Date().toISOString() });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api', registerRouter);
app.use('/', webhookRouter);

// Global error handler
app.use((err, _req, res, _next) => {
  logger.error('Unhandled express error', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = env.PORT;
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});
