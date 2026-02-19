// ================================================================
// machu.la — Supabase Edge Function: broadcast-sms
// Two modes:
//   broadcast → same message sent to all active subscribers
//   decision  → personalized message with {pin} replaced per subscriber
//
// Fully international — any E.164 number (+49, +44, +61, etc.) works.
//
// ENV VARS (Supabase dashboard → Settings → Edge Functions → Secrets):
//   TWILIO_ACCOUNT_SID     → your Twilio Account SID
//   TWILIO_AUTH_TOKEN      → your Twilio Auth Token
//   TWILIO_FROM_NUMBER     → your Twilio number in E.164, e.g. +16135551234
//   SUPABASE_URL           → auto-set by Supabase
//   SUPABASE_SERVICE_ROLE_KEY → auto-set by Supabase
//
// NOTE: Enable international countries in:
//   Twilio Console → Messaging → Settings → Geo Permissions
// ================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TWILIO_ACCOUNT_SID   = Deno.env.get('TWILIO_ACCOUNT_SID')!
const TWILIO_AUTH_TOKEN    = Deno.env.get('TWILIO_AUTH_TOKEN')!
const TWILIO_FROM          = Deno.env.get('TWILIO_FROM_NUMBER')!
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ENCRYPTION_KEY       = Deno.env.get('ENCRYPTION_KEY')!

const _enc = new TextEncoder()
const _dec = new TextDecoder()

// ── AES-256-GCM decrypt (phone numbers stored encrypted) ──────
async function getAesKey(): Promise<CryptoKey> {
  const bytes = new Uint8Array(ENCRYPTION_KEY.match(/.{2}/g)!.map(b => parseInt(b, 16)))
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['decrypt'])
}
async function decryptField(stored: string): Promise<string> {
  if (!stored?.includes(':')) return stored
  try {
    const [ivHex, ctHex] = stored.split(':')
    const fromHex = (h: string) => new Uint8Array(h.match(/.{2}/g)!.map(b => parseInt(b, 16)))
    const key = await getAesKey()
    const pt  = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromHex(ivHex) }, key, fromHex(ctHex))
    return _dec.decode(pt)
  } catch { return stored }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── Phone normalisation ────────────────────────────────────────
function normalisePhone(raw: string): string | null {
  const stripped = raw.trim().replace(/[\s\-\.\(\)]/g, '')
  const digits = stripped.replace(/^\+/, '')
  if (!/^\d{7,15}$/.test(digits)) return null
  if (stripped.startsWith('+')) return stripped
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return `+${digits}`
}

// ── Twilio send ────────────────────────────────────────────────
async function sendSMS(to: string, body: string): Promise<string | null> {
  const formBody = new URLSearchParams({ To: to, From: TWILIO_FROM, Body: body })
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formBody.toString(),
    }
  )
  if (res.ok) return null
  const err: any = await res.json()
  return err.message ?? 'unknown Twilio error'
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  // ── Auth: service role key as Bearer ──
  const auth = req.headers.get('Authorization')?.replace('Bearer ', '').trim()
  if (auth !== SUPABASE_SERVICE_KEY) {
    return json({ error: 'Unauthorized' }, 401)
  }

  // ── Parse body ──
  let body: { mode?: string; message?: string; template?: string }
  try { body = await req.json() }
  catch { return json({ error: 'Invalid JSON' }, 400) }

  const mode = body.mode ?? 'broadcast'

  // ── Fetch active subscribers ──
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const { data: subscribers, error: dbErr } = await admin
    .from('subscribers')
    .select('name, phone, pin_code')
    .eq('active', true)

  if (dbErr) return json({ error: dbErr.message }, 500)

  let sent = 0
  let skipped = 0
  const errors: string[] = []

  // ────────────────────────────────────────────────────────────
  // MODE: broadcast — same message to everyone
  // ────────────────────────────────────────────────────────────
  if (mode === 'broadcast') {
    const message = body.message?.trim()
    if (!message) return json({ error: 'No message provided' }, 400)

    for (const s of subscribers ?? []) {
      const plainPhone = await decryptField(s.phone ?? '')
      const e164 = normalisePhone(plainPhone)
      if (!e164) { skipped++; continue }
      const err = await sendSMS(e164, message)
      if (err) errors.push(`${e164}: ${err}`)   // no name in error — keep PII out of logs
      else sent++
    }
  }

  // ────────────────────────────────────────────────────────────
  // MODE: decision — personalized, {pin} replaced per subscriber
  // ────────────────────────────────────────────────────────────
  else if (mode === 'decision') {
    const template = body.template?.trim()
    if (!template) return json({ error: 'No template provided' }, 400)

    for (const s of subscribers ?? []) {
      const plainPhone = await decryptField(s.phone ?? '')
      const e164 = normalisePhone(plainPhone)
      if (!e164) { skipped++; continue }

      const pin = s.pin_code?.trim()
      const message = pin
        ? template.replace(/\{pin\}/gi, pin)
        : template.replace(/\{pin\}/gi, '(check your email or DM for PIN)')

      const err = await sendSMS(e164, message)
      if (err) errors.push(`${e164}: ${err}`)
      else sent++
    }
  }

  else {
    return json({ error: `Unknown mode: ${mode}` }, 400)
  }

  return json({ sent, skipped, errors })
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
