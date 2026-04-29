CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── TABLES ───────────────────────────────────────────────────────────────────

CREATE TABLE profiles (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164           TEXT        UNIQUE NOT NULL,
  full_name            TEXT,
  whatsapp_name        TEXT,
  denomination         TEXT        DEFAULT 'prefere_nao_responder'
                                   CHECK (denomination IN ('catolico','evangelico','cristao_sem_igreja','acredita_em_deus','prefere_nao_responder')),
  heart_context        TEXT,
  onboarding_completed BOOLEAN     DEFAULT false,
  opt_in_whatsapp      BOOLEAN     DEFAULT true,
  opt_in_at            TIMESTAMPTZ DEFAULT now(),
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE conversations (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status          TEXT        DEFAULT 'active'
                              CHECK (status IN ('active','closed')),
  channel         TEXT        DEFAULT 'whatsapp',
  safety_flag     BOOLEAN     DEFAULT false,
  safety_level    TEXT        DEFAULT 'none'
                              CHECK (safety_level IN ('none','low','medium','high','crisis')),
  summary         TEXT,
  last_message_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE messages (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id      UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  profile_id           UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  direction            TEXT        NOT NULL CHECK (direction IN ('inbound','outbound')),
  role                 TEXT        NOT NULL CHECK (role IN ('user','assistant','system')),
  content_type         TEXT        DEFAULT 'text' CHECK (content_type IN ('text')),
  text_body            TEXT,
  provider_message_sid TEXT,
  provider             TEXT        DEFAULT 'twilio',
  provider_status      TEXT        CHECK (provider_status IS NULL OR provider_status IN ('received','pending','sent','failed')),
  raw_payload          JSONB,
  error_message        TEXT,
  created_at           TIMESTAMPTZ DEFAULT now()
);

-- ─── INDEXES ──────────────────────────────────────────────────────────────────

CREATE INDEX idx_profiles_phone
  ON profiles(phone_e164);

CREATE INDEX idx_conversations_profile_status
  ON conversations(profile_id, status);

CREATE INDEX idx_messages_conversation_created
  ON messages(conversation_id, created_at);

CREATE INDEX idx_messages_profile_created
  ON messages(profile_id, created_at);

CREATE UNIQUE INDEX idx_messages_provider_sid
  ON messages(provider_message_sid)
  WHERE provider_message_sid IS NOT NULL;

-- ─── ROW LEVEL SECURITY ───────────────────────────────────────────────────────

ALTER TABLE profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages      ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_profiles"
  ON profiles FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_conversations"
  ON conversations FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_messages"
  ON messages FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ─── TRIGGERS ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
