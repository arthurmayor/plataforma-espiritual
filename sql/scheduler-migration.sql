-- Sequência diária D1–D7
-- Rode no SQL Editor do Supabase ANTES de testar o endpoint /api/scheduler/run.

-- content_deliveries: número do dia (0 = onboarding, 1–7 = envios diários)
ALTER TABLE content_deliveries ADD COLUMN IF NOT EXISTS day_number INTEGER;

-- content_deliveries: tema e passagem usados (para não repetir entre os dias)
ALTER TABLE content_deliveries ADD COLUMN IF NOT EXISTS theme TEXT;
ALTER TABLE content_deliveries ADD COLUMN IF NOT EXISTS scripture_ref TEXT;

-- profiles: data de início do ciclo de 7 dias (preenchida no onboarding)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS sequence_start_date DATE;

-- Índice para a checagem de idempotência (profile_id + day_number)
CREATE INDEX IF NOT EXISTS idx_content_deliveries_profile_day
  ON content_deliveries (profile_id, day_number);

-- Recarrega o cache de schema do PostgREST para reconhecer as novas colunas
NOTIFY pgrst, 'reload schema';
