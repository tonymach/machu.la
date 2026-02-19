-- ================================================================
-- machu.la — Database migrations
-- Run this in Supabase → SQL Editor (or via deploy script)
-- Uses DROP POLICY IF EXISTS + CREATE POLICY (no IF NOT EXISTS on policies)
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
DROP POLICY IF EXISTS "cr_insert"  ON call_requests;
DROP POLICY IF EXISTS "cr_reads"   ON call_requests;
DROP POLICY IF EXISTS "cr_deletes" ON call_requests;
CREATE POLICY "cr_insert"  ON call_requests FOR INSERT WITH CHECK (true);
CREATE POLICY "cr_reads"   ON call_requests FOR SELECT USING (auth.role() = 'service_role');
CREATE POLICY "cr_deletes" ON call_requests FOR DELETE USING (auth.role() = 'service_role');

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
DROP POLICY IF EXISTS "nr_insert"  ON network_requests;
DROP POLICY IF EXISTS "nr_reads"   ON network_requests;
DROP POLICY IF EXISTS "nr_deletes" ON network_requests;
CREATE POLICY "nr_insert"  ON network_requests FOR INSERT WITH CHECK (true);
CREATE POLICY "nr_reads"   ON network_requests FOR SELECT USING (auth.role() = 'service_role');
CREATE POLICY "nr_deletes" ON network_requests FOR DELETE USING (auth.role() = 'service_role');

-- ── subscribers (SMS blog list — Anthony-curated) ─────────────
CREATE TABLE IF NOT EXISTS subscribers (
  id         uuid default gen_random_uuid() primary key,
  name       text not null,
  phone      text not null,
  notes      text,
  active     boolean default true,
  created_at timestamptz default now()
);
ALTER TABLE subscribers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sub_insert"  ON subscribers;
DROP POLICY IF EXISTS "sub_reads"   ON subscribers;
DROP POLICY IF EXISTS "sub_updates" ON subscribers;
DROP POLICY IF EXISTS "sub_deletes" ON subscribers;
CREATE POLICY "sub_insert"  ON subscribers FOR INSERT  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "sub_reads"   ON subscribers FOR SELECT  USING     (auth.role() = 'service_role');
CREATE POLICY "sub_updates" ON subscribers FOR UPDATE  USING     (auth.role() = 'service_role');
CREATE POLICY "sub_deletes" ON subscribers FOR DELETE  USING     (auth.role() = 'service_role');

-- Add pin_code + how_met to subscribers (safe to re-run)
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS pin_code text;
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS how_met  text;

-- ── rate_limits (per-IP counters for Edge Function rate limiting) ─
CREATE TABLE IF NOT EXISTS rate_limits (
  id           text PRIMARY KEY,
  count        int DEFAULT 1,
  window_start timestamptz DEFAULT now()
);
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rl_service_all" ON rate_limits;
CREATE POLICY "rl_service_all" ON rate_limits FOR ALL USING (auth.role() = 'service_role');

-- ── Tighten pins RLS — no public read; route through verify-pin Edge Function ──
DROP POLICY IF EXISTS "Public can read pins" ON pins;
DROP POLICY IF EXISTS "pins_public_read"     ON pins;
DROP POLICY IF EXISTS "pins_anon_read"       ON pins;
DROP POLICY IF EXISTS "Enable read for all"  ON pins;
DROP POLICY IF EXISTS "pins_service_only"    ON pins;
CREATE POLICY "pins_service_only" ON pins FOR SELECT USING (auth.role() = 'service_role');

-- ── inbound_sms (replies from subscribers) ───────────────────
CREATE TABLE IF NOT EXISTS inbound_sms (
  id          uuid default gen_random_uuid() primary key,
  from_number text not null,
  body        text,
  received_at timestamptz default now()
);
ALTER TABLE inbound_sms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "inbound_insert"  ON inbound_sms;
DROP POLICY IF EXISTS "inbound_reads"   ON inbound_sms;
DROP POLICY IF EXISTS "inbound_deletes" ON inbound_sms;
CREATE POLICY "inbound_insert"  ON inbound_sms FOR INSERT WITH CHECK (true);
CREATE POLICY "inbound_reads"   ON inbound_sms FOR SELECT USING (auth.role() = 'service_role');
CREATE POLICY "inbound_deletes" ON inbound_sms FOR DELETE USING (auth.role() = 'service_role');
