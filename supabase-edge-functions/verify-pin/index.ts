// ================================================================
// machu.la — verify-pin (rate-limited PIN validation)
// ================================================================
// Validates a PIN against the pins table.
// Returns { valid: boolean } only — no sensitive data exposed.
// Rate limits: max 10 attempts per 5-minute window per IP.
//
// Auth: None (public endpoint, but rate-limited)
// ================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
}

const WINDOW_MS = 5 * 60 * 1000  // 5 minutes
const MAX_ATTEMPTS = 10

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }

  try {
    const body = await req.json()
    const pin = (body.pin ?? '').toString().trim().toUpperCase()

    if (!pin) {
      return new Response(JSON.stringify({ valid: false }), {
        status: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    }

    // Get client IP for rate limiting
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
    const rlKey = `${ip}:verify-pin`

    // Initialize Supabase service client
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // Check rate limit
    const now = new Date()
    const windowStart = new Date(now.getTime() - WINDOW_MS)

    const { data: existing } = await sb
      .from('rate_limits')
      .select('count, window_start')
      .eq('id', rlKey)
      .maybeSingle()

    if (existing) {
      const windowStartTime = new Date(existing.window_start)
      if (windowStartTime.getTime() > windowStart.getTime()) {
        // Still in the same window
        if (existing.count >= MAX_ATTEMPTS) {
          return new Response(JSON.stringify({ valid: false }), {
            status: 429,
            headers: { ...CORS, 'Content-Type': 'application/json' }
          })
        }
        // Increment count
        await sb
          .from('rate_limits')
          .update({ count: existing.count + 1 })
          .eq('id', rlKey)
      } else {
        // New window — reset
        await sb
          .from('rate_limits')
          .update({ count: 1, window_start: now.toISOString() })
          .eq('id', rlKey)
      }
    } else {
      // Create new entry
      await sb.from('rate_limits').insert({
        id: rlKey,
        count: 1,
        window_start: now.toISOString()
      })
    }

    // Query pins table to verify PIN
    const { data, error } = await sb
      .from('pins')
      .select('code')
      .eq('code', pin)
      .limit(1)

    const valid = !error && data && data.length > 0

    return new Response(JSON.stringify({ valid }), {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('verify-pin error:', err)
    return new Response(JSON.stringify({ valid: false }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }
})
