-- ================================================================
-- machu.la — Database migrations
-- Run this in Supabase → SQL Editor (or via deploy script)
-- ================================================================

-- ── call_requests (oracle connect form) ──────────────────────
CREATE TABLE IF NOT EXISTS call_requests (
  id               uuid default gen_random_uuid() primary key,
  name             text not null,
  contact          text not null,
  trigger_question text,
  created_at       timestamptz default now()
);
ALTER TABLE call_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "cr_insert"  ON call_requests FOR INSERT WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "cr_reads"   ON call_requests FOR SELECT USING (auth.role() = 'service_role');
CREATE POLICY IF NOT EXISTS "cr_deletes" ON call_requests FOR DELETE USING (auth.role() = 'service_role');

-- ── network_requests (legacy help form) ──────────────────────
CREATE TABLE IF NOT EXISTS network_requests (
  id         uuid default gen_random_uuid() primary key,
  name       text,
  email      text,
  need       text,
  offer      text,
  created_at timestamptz default now()
);
ALTER TABLE network_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "nr_insert"  ON network_requests FOR INSERT WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "nr_reads"   ON network_requests FOR SELECT USING (auth.role() = 'service_role');
CREATE POLICY IF NOT EXISTS "nr_deletes" ON network_requests FOR DELETE USING (auth.role() = 'service_role');

-- ── subscribers (SMS blog list — Anthony-curated) ─────────────
CREATE TABLE IF NOT EXISTS subscribers (
  id         uuid default gen_random_uuid() primary key,
  name       text not null,
  phone      text not null,          -- E.164 format, e.g. +16475551234
  notes      text,                   -- optional context ("brother in Germany", etc.)
  active     boolean default true,   -- false = opted out via STOP
  created_at timestamptz default now(),
  UNIQUE(phone)
);
ALTER TABLE subscribers ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "sub_insert"  ON subscribers FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY IF NOT EXISTS "sub_reads"   ON subscribers FOR SELECT USING (auth.role() = 'service_role');
CREATE POLICY IF NOT EXISTS "sub_updates" ON subscribers FOR UPDATE USING (auth.role() = 'service_role');
CREATE POLICY IF NOT EXISTS "sub_deletes" ON subscribers FOR DELETE USING (auth.role() = 'service_role');

-- Add pin_code + how_met to subscribers (safe to re-run)
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS pin_code text;
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS how_met text;

-- ── inbound_sms (replies from subscribers) ───────────────────
CREATE TABLE IF NOT EXISTS inbound_sms (
  id          uuid default gen_random_uuid() primary key,
  from_number text not null,
  body        text,
  received_at timestamptz default now()
);
ALTER TABLE inbound_sms ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "inbound_insert" ON inbound_sms FOR INSERT WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "inbound_reads"  ON inbound_sms FOR SELECT USING (auth.role() = 'service_role');
CREATE POLICY IF NOT EXISTS "inbound_deletes" ON inbound_sms FOR DELETE USING (auth.role() = 'service_role');
