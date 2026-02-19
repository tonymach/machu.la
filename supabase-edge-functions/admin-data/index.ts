// ================================================================
// machu.la — admin-data  (encrypted PII proxy)
// ================================================================
// The browser never receives an encryption key.
// All subscriber reads are decrypted server-side here before returning.
// All subscriber writes are encrypted server-side here before storing.
// The service role key stays in the browser only as an auth token
// for this function — it never touches raw PII directly.
//
// Routes (method + ?resource=):
//   GET  ?resource=subscribers    → decrypt + return list
//   GET  ?resource=replies        → return inbound_sms
//   POST body: { resource, action, data?, id? }
//     action=upsert  → encrypt PII + upsert subscriber
//     action=delete  → delete by id
//     action=toggle  → toggle subscriber.active
//
// Auth: Authorization: Bearer <service_role_key>
// ================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ENCRYPTION_KEY       = Deno.env.get('ENCRYPTION_KEY')!

const enc = new TextEncoder()
const dec = new TextDecoder()

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── AES-256-GCM ───────────────────────────────────────────────
async function getAesKey(): Promise<CryptoKey> {
  const bytes = new Uint8Array(ENCRYPTION_KEY.match(/.{2}/g)!.map(b => parseInt(b, 16)))
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

async function encrypt(plaintext: string): Promise<string> {
  const key = await getAesKey()
  const iv  = crypto.getRandomValues(new Uint8Array(12))
  const ct  = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext))
  const hex = (b: Uint8Array) => Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('')
  return `${hex(iv)}:${hex(new Uint8Array(ct))}`
}

async function decrypt(stored: string): Promise<string> {
  if (!stored?.includes(':')) return stored   // plaintext legacy
  try {
    const [ivHex, ctHex] = stored.split(':')
    const fromHex = (h: string) => new Uint8Array(h.match(/.{2}/g)!.map(b => parseInt(b, 16)))
    const key = await getAesKey()
    const pt  = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromHex(ivHex) }, key, fromHex(ctHex))
    return dec.decode(pt)
  } catch { return stored }
}

// ── Auth check ────────────────────────────────────────────────
function isAuthorised(req: Request): boolean {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '').trim()
  return token === SUPABASE_SERVICE_KEY
}

// ── PIN generator (crypto-secure) ─────────────────────────────
function generatePin(): string {
  const bytes = new Uint8Array(4)
  crypto.getRandomValues(bytes)
  return new DataView(bytes.buffer).getUint32(0).toString(36).slice(-6).toUpperCase().padStart(6, '0')
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  if (!isAuthorised(req)) {
    return json({ error: 'Unauthorised' }, 401)
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const url   = new URL(req.url)

  // ── GET ───────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const resource = url.searchParams.get('resource')

    if (resource === 'subscribers') {
      const { data, error } = await admin
        .from('subscribers').select('*').order('created_at', { ascending: false })
      if (error) return json({ error: error.message }, 500)

      // Decrypt PII fields
      const decrypted = await Promise.all((data ?? []).map(async s => ({
        ...s,
        name:    s.name    ? await decrypt(s.name)    : '',
        phone:   s.phone   ? await decrypt(s.phone)   : '',
        how_met: s.how_met ? await decrypt(s.how_met) : null,
      })))
      return json(decrypted)
    }

    if (resource === 'replies') {
      const { data, error } = await admin
        .from('inbound_sms').select('*').order('received_at', { ascending: false }).limit(50)
      if (error) return json({ error: error.message }, 500)
      return json(data)
    }

    return json({ error: 'Unknown resource' }, 400)
  }

  // ── POST ──────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = await req.json()
    const { resource, action, data, id } = body

    if (resource === 'subscribers') {
      if (action === 'upsert') {
        // data: { name, phone, how_met, pin_code? }
        const e164 = data.phone   // already normalised by client
        const pin  = data.pin_code ?? generatePin()

        const [encName, encPhone, encHowMet] = await Promise.all([
          encrypt(data.name ?? ''),
          encrypt(e164),
          data.how_met ? encrypt(data.how_met) : Promise.resolve(null),
        ])

        // Also create a PIN entry so they can vote
        await admin.from('pins').upsert({ code: pin, label: data.name }, { onConflict: 'code' })

        const { error } = await admin.from('subscribers').insert({
          name:    encName,
          phone:   encPhone,
          pin_code: pin,
          how_met: encHowMet,
          active:  true,
        })
        if (error) return json({ error: error.message }, 500)
        return json({ ok: true, pin })
      }

      if (action === 'toggle') {
        const { data: current } = await admin.from('subscribers').select('active').eq('id', id).single()
        const { error } = await admin.from('subscribers').update({ active: !current?.active }).eq('id', id)
        if (error) return json({ error: error.message }, 500)
        return json({ ok: true })
      }

      if (action === 'delete') {
        const { error } = await admin.from('subscribers').delete().eq('id', id)
        if (error) return json({ error: error.message }, 500)
        return json({ ok: true })
      }
    }

    if (resource === 'replies' && action === 'delete') {
      const { error } = await admin.from('inbound_sms').delete().eq('id', id)
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true })
    }

    return json({ error: 'Unknown action' }, 400)
  }

  return json({ error: 'Method not allowed' }, 405)
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
