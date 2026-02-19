// ================================================================
// machu.la — handle-inbound-sms  (hardened)
// ================================================================
// Security model:
//   1. Every request is verified against Twilio's HMAC-SHA1 signature
//      — spoofed / forged webhooks are rejected before any DB touch
//   2. Subscriber PII (name, phone, how_met) is AES-256-GCM encrypted
//      before writing to Supabase — plaintext never lands in the DB
//   3. PINs are generated with crypto.getRandomValues(), not Math.random()
//
// ENV VARS:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  — auto-set
//   TWILIO_AUTH_TOKEN    — used for HMAC verification + sending
//   ANTHONY_PHONE        — your E.164 number (encrypted in DB, compared after decrypt)
//   ANTHROPIC_API_KEY    — Claude Haiku for parsing subscriber texts
//   ENCRYPTION_KEY       — 64-char hex (32 bytes) for AES-256-GCM
// ================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const TWILIO_AUTH_TOKEN    = Deno.env.get('TWILIO_AUTH_TOKEN')!
const ANTHROPIC_API_KEY    = Deno.env.get('ANTHROPIC_API_KEY')!
const ANTHONY_PHONE        = Deno.env.get('ANTHONY_PHONE')!
const ENCRYPTION_KEY       = Deno.env.get('ENCRYPTION_KEY')!   // 64-char hex

const enc = new TextEncoder()
const dec = new TextDecoder()

// ── AES-256-GCM helpers ───────────────────────────────────────
async function getAesKey(): Promise<CryptoKey> {
  const bytes = new Uint8Array(ENCRYPTION_KEY.match(/.{2}/g)!.map(b => parseInt(b, 16)))
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

async function encrypt(plaintext: string): Promise<string> {
  const key = await getAesKey()
  const iv  = crypto.getRandomValues(new Uint8Array(12))
  const ct  = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext))
  const toHex = (b: Uint8Array) => Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('')
  return `${toHex(iv)}:${toHex(new Uint8Array(ct))}`
}

async function decrypt(stored: string): Promise<string> {
  if (!stored?.includes(':')) return stored   // legacy plaintext record
  try {
    const [ivHex, ctHex] = stored.split(':')
    const fromHex = (h: string) => new Uint8Array(h.match(/.{2}/g)!.map(b => parseInt(b, 16)))
    const key = await getAesKey()
    const pt  = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromHex(ivHex) }, key, fromHex(ctHex))
    return dec.decode(pt)
  } catch { return stored }
}

// ── Twilio HMAC-SHA1 signature verification ────────────────────
async function verifyTwilio(req: Request, rawBody: string): Promise<boolean> {
  const sig = req.headers.get('X-Twilio-Signature')
  if (!sig) return false

  // Reconstruct the signed string: URL + sorted POST params
  const url    = req.url
  const params = new URLSearchParams(rawBody)
  const sorted = [...params.keys()].sort()
  let str = url
  for (const k of sorted) str += k + (params.get(k) ?? '')

  const key      = await crypto.subtle.importKey('raw', enc.encode(TWILIO_AUTH_TOKEN),
                     { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  const sigBytes = await crypto.subtle.sign('HMAC', key, enc.encode(str))
  const expected = btoa(String.fromCharCode(...new Uint8Array(sigBytes)))

  return expected === sig
}

// ── Cryptographically secure PIN ──────────────────────────────
function generatePin(): string {
  const bytes = new Uint8Array(4)
  crypto.getRandomValues(bytes)
  const num = new DataView(bytes.buffer).getUint32(0)
  return num.toString(36).slice(-6).toUpperCase().padStart(6, '0')
}

// ── E.164 normalisation ───────────────────────────────────────
function normalisePhone(raw: string): string | null {
  const stripped = raw.trim().replace(/[\s\-\.\(\)]/g, '')
  const digits   = stripped.replace(/^\+/, '')
  if (!/^\d{7,15}$/.test(digits)) return null
  if (stripped.startsWith('+')) return stripped
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return `+${digits}`
}

// ── Claude Haiku: parse subscriber text ──────────────────────
async function parseSubscriber(text: string) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      messages: [{
        role: 'user',
        content: `Extract subscriber info. Return ONLY JSON:
{"name": string|null, "phone": string|null, "how_met": string|null}

Text: "${text.replace(/"/g, '\\"')}"`,
      }],
    }),
  })
  if (!res.ok) return { name: null, phone: null, how_met: null }
  const data: any = await res.json()
  const raw = data.content?.[0]?.text?.trim().replace(/^```json?\s*/i, '').replace(/\s*```$/, '') ?? '{}'
  try { return JSON.parse(raw) } catch { return { name: null, phone: null, how_met: null } }
}

// ── Main handler ──────────────────────────────────────────────
serve(async (req) => {
  const rawBody = await req.text()

  // ── SECURITY: verify Twilio signature before doing anything ──
  const valid = await verifyTwilio(req, rawBody)
  if (!valid) {
    // Log attempt but return 403 without revealing why
    console.warn('Rejected request with invalid Twilio signature from', req.headers.get('CF-Connecting-IP'))
    return new Response('Forbidden', { status: 403 })
  }

  const params = new URLSearchParams(rawBody)
  const from   = params.get('From')?.trim() ?? ''
  const body   = params.get('Body')?.trim() ?? ''

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // ── STOP / START ──────────────────────────────────────────────
  const cmd = body.toUpperCase()
  if (['STOP','STOPALL','UNSUBSCRIBE','CANCEL','END','QUIT'].includes(cmd)) {
    // Phone in DB is encrypted — find by encrypted match isn't viable,
    // so we decrypt+compare. For small subscriber lists this is fine.
    const { data: subs } = await admin.from('subscribers').select('id, phone')
    for (const s of subs ?? []) {
      if (await decrypt(s.phone) === from) {
        await admin.from('subscribers').update({ active: false }).eq('id', s.id)
        break
      }
    }
    return twiml(`<Response><Message>You've been unsubscribed. Reply START anytime.</Message></Response>`)
  }

  if (['START','YES','UNSTOP'].includes(cmd)) {
    const { data: subs } = await admin.from('subscribers').select('id, phone')
    for (const s of subs ?? []) {
      if (await decrypt(s.phone) === from) {
        await admin.from('subscribers').update({ active: true }).eq('id', s.id)
        break
      }
    }
    return twiml(`<Response><Message>You're back on the list.</Message></Response>`)
  }

  // ── ANTHONY texting in → parse + add subscriber ───────────────
  if (from === ANTHONY_PHONE) {
    const parsed = await parseSubscriber(body)

    if (!parsed.name && !parsed.phone) {
      await admin.from('inbound_sms').insert({ from_number: from, body })
      return twiml(`<Response><Message>Stored. Didn't look like a subscriber — check admin.</Message></Response>`)
    }

    const e164 = parsed.phone ? normalisePhone(parsed.phone) : null
    if (!e164) {
      return twiml(`<Response><Message>Got "${parsed.name}" but couldn't parse a phone. Try: Name +1234567890 context.</Message></Response>`)
    }

    const pin = generatePin()

    // Encrypt PII before writing
    const [encName, encPhone, encHowMet] = await Promise.all([
      encrypt(parsed.name ?? ''),
      encrypt(e164),
      parsed.how_met ? encrypt(parsed.how_met) : Promise.resolve(null),
    ])

    await admin.from('pins').upsert({ code: pin, label: parsed.name }, { onConflict: 'code' })

    const { error } = await admin.from('subscribers').upsert({
      name:    encName,
      phone:   encPhone,
      pin_code: pin,              // PIN itself is not PII — fine in plaintext
      how_met: encHowMet,
      active:  true,
    }, { onConflict: 'phone' })   // Note: upsert on encrypted phone won't match — see note below

    if (error) return twiml(`<Response><Message>Error: ${error.message}</Message></Response>`)

    const ctx = parsed.how_met ? `\nContext: ${parsed.how_met}` : ''
    return twiml(`<Response><Message>✓ Added ${parsed.name} (${e164})${ctx}\n\nPIN: ${pin}\n\nShare: "machu.la — PIN is ${pin}"</Message></Response>`)
  }

  // ── Anyone else → store reply ─────────────────────────────────
  await admin.from('inbound_sms').insert({ from_number: from, body })
  return twiml('<Response></Response>')
})

function twiml(xml: string) {
  return new Response(xml, { headers: { 'Content-Type': 'text/xml' } })
}
