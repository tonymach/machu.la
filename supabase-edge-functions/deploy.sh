#!/usr/bin/env bash
# ================================================================
# machu.la — One-shot deploy script
# Run this once to set up everything: tables, edge functions, secrets.
#
# Usage:
#   chmod +x deploy.sh
#   ./deploy.sh
#
# You'll need:
#   - Supabase CLI installed: npm install -g supabase
#   - A Supabase personal access token (supabase.com/dashboard/account/tokens)
#   - Your Supabase service role key (dashboard → Settings → API)
#   - Twilio Account SID, Auth Token, and From number
#   - Anthropic API key (console.anthropic.com → API keys)
#
# Security note:
#   ENCRYPTION_KEY is auto-generated from /dev/urandom — never stored in
#   this script, printed to your terminal once, and sent directly to
#   Supabase secrets. Write it down somewhere safe; without it any existing
#   encrypted PII in the DB becomes unreadable.
# ================================================================

set -e

PROJECT_REF="cnzsytyjsenvyemmvwzv"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║       machu.la — Deploy Everything       ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── Credentials ──────────────────────────────────────────────────
read -p "Supabase personal access token (from supabase.com/dashboard/account/tokens): " SUPABASE_ACCESS_TOKEN
read -p "Supabase service role key (Settings → API → service_role): " SUPABASE_SERVICE_KEY
read -p "Twilio Account SID (starts with AC): " TWILIO_ACCOUNT_SID
read -p "Twilio Auth Token: " TWILIO_AUTH_TOKEN
read -p "Twilio From number (E.164, e.g. +16135551234): " TWILIO_FROM_NUMBER
read -p "Your own phone number (E.164, e.g. +16475551234) — so texts FROM you trigger subscriber adds: " ANTHONY_PHONE
read -p "Anthropic API key (console.anthropic.com → API keys): " ANTHROPIC_API_KEY

# ── Auto-generate encryption key ─────────────────────────────────
# 32 bytes = 256 bits, cryptographically random, formatted as 64-char hex
echo ""
echo "── Generating AES-256 encryption key ──"
ENCRYPTION_KEY=$(openssl rand -hex 32)
echo ""
echo "┌─────────────────────────────────────────────────────────────┐"
echo "│  ⚠  SAVE THIS KEY — you cannot recover encrypted data       │"
echo "│     without it. Store it in 1Password / your vault.         │"
echo "│                                                             │"
echo "│  ENCRYPTION_KEY = $ENCRYPTION_KEY  │"
echo "└─────────────────────────────────────────────────────────────┘"
echo ""
read -p "I've saved the key above. Press ENTER to continue..." _confirm

echo ""
echo "── Step 1: Run database migrations ──"
curl -s -X POST \
  "https://api.supabase.com/v1/projects/$PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"query\": $(cat "$SCRIPT_DIR/migrations.sql" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))")}" \
  | python3 -m json.tool
echo ""
echo "✓ Migrations run"

echo ""
echo "── Step 2: Deploy Edge Functions ──"
export SUPABASE_ACCESS_TOKEN

# Copy functions to standard Supabase location for CLI
mkdir -p "$SCRIPT_DIR/../supabase/functions/broadcast-sms"
mkdir -p "$SCRIPT_DIR/../supabase/functions/handle-inbound-sms"
mkdir -p "$SCRIPT_DIR/../supabase/functions/admin-data"
cp "$SCRIPT_DIR/broadcast-sms/index.ts"     "$SCRIPT_DIR/../supabase/functions/broadcast-sms/index.ts"
cp "$SCRIPT_DIR/handle-inbound-sms/index.ts" "$SCRIPT_DIR/../supabase/functions/handle-inbound-sms/index.ts"
cp "$SCRIPT_DIR/admin-data/index.ts"         "$SCRIPT_DIR/../supabase/functions/admin-data/index.ts"

supabase functions deploy broadcast-sms --project-ref "$PROJECT_REF"
supabase functions deploy handle-inbound-sms --project-ref "$PROJECT_REF"
supabase functions deploy admin-data --project-ref "$PROJECT_REF"
echo "✓ Edge Functions deployed (broadcast-sms, handle-inbound-sms, admin-data)"

echo ""
echo "── Step 3: Set Edge Function secrets ──"
supabase secrets set --project-ref "$PROJECT_REF" \
  TWILIO_ACCOUNT_SID="$TWILIO_ACCOUNT_SID" \
  TWILIO_AUTH_TOKEN="$TWILIO_AUTH_TOKEN" \
  TWILIO_FROM_NUMBER="$TWILIO_FROM_NUMBER" \
  ANTHONY_PHONE="$ANTHONY_PHONE" \
  ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  ENCRYPTION_KEY="$ENCRYPTION_KEY"
echo "✓ Secrets set (including ENCRYPTION_KEY)"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║              All done! ✦                 ║"
echo "╠══════════════════════════════════════════╣"
echo "║  Final manual step (30 seconds):         ║"
echo "║                                          ║"
echo "║  In Twilio Console:                      ║"
echo "║  Phone Numbers → your number →           ║"
echo "║  Messaging → A message comes in          ║"
echo "║  → Webhook → POST → paste this URL:      ║"
echo "║                                          ║"
echo "║  https://$PROJECT_REF.supabase.co/functions/v1/handle-inbound-sms"
echo "║                                          ║"
echo "║  Also enable international countries in: ║"
echo "║  Messaging → Settings → Geo Permissions  ║"
echo "╚══════════════════════════════════════════╝"
echo ""
