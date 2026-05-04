-- ─── ONBOARDING MIGRATION ────────────────────────────────────────────────────
-- Run this in the Supabase SQL Editor after supabase-schema.sql

-- Add plan_status to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS plan_status TEXT NOT NULL DEFAULT 'free'
    CHECK (plan_status IN ('free','premium'));

-- ─── user_preferences ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_preferences (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id       UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  emotional_state  TEXT,
  pain_point       TEXT,
  tone_preference  TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_user_preferences_profile UNIQUE (profile_id)
);

ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_user_preferences"
  ON user_preferences FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE TRIGGER user_preferences_updated_at
  BEFORE UPDATE ON user_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─── content_delivery ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS content_delivery (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status          TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','sent','failed')),
  input_context   JSONB,
  generated_text  TEXT,
  sent_at         TIMESTAMPTZ,
  error_message   TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_content_delivery_profile_created
  ON content_delivery(profile_id, created_at);

ALTER TABLE content_delivery ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_content_delivery"
  ON content_delivery FOR ALL TO service_role
  USING (true) WITH CHECK (true);
