# machu.la — SMS Broadcast Setup

## What this does
When you hit **↗ Send SMS** in the admin Network tab, it calls a Supabase Edge Function
that reads every `call_requests` contact with a phone number and fires a Twilio SMS to each one.

---

## Step 1 — Twilio (5 min)

1. Sign up at [twilio.com](https://www.twilio.com) (free trial works fine)
2. Grab a number (get a Canadian +1-613 or wherever)
3. Note down:
   - **Account SID** (starts with `AC…`)
   - **Auth Token**
   - **From number** (e.g. `+16135551234`)

---

## Step 2 — Supabase CLI (one time)

```bash
npm install -g supabase
supabase login
```

---

## Step 3 — Link your project

```bash
# In the machu.la repo root (or anywhere)
supabase link --project-ref cnzsytyjsenvyemmvwzv
```

---

## Step 4 — Deploy the Edge Function

```bash
# From the repo root — point at the folder
supabase functions deploy broadcast-sms \
  --project-ref cnzsytyjsenvyemmvwzv \
  --import-map supabase-edge-functions/broadcast-sms/index.ts
```

Or the simpler way — copy the function into a standard Supabase functions folder and deploy:

```bash
mkdir -p supabase/functions/broadcast-sms
cp supabase-edge-functions/broadcast-sms/index.ts supabase/functions/broadcast-sms/index.ts
supabase functions deploy broadcast-sms --project-ref cnzsytyjsenvyemmvwzv
```

---

## Step 5 — Set secrets

In the Supabase dashboard: **Settings → Edge Functions → Secrets**, add:

| Key | Value |
|-----|-------|
| `TWILIO_ACCOUNT_SID` | `ACxxxxxxxxxxxxxxxx` |
| `TWILIO_AUTH_TOKEN` | `your_auth_token` |
| `TWILIO_FROM_NUMBER` | `+16135551234` |

(`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set automatically.)

---

## Step 6 — Create the call_requests table (if not done yet)

In Supabase → SQL Editor:

```sql
CREATE TABLE call_requests (
  id            uuid default gen_random_uuid() primary key,
  name          text not null,
  contact       text not null,
  trigger_question text,
  created_at    timestamptz default now()
);

ALTER TABLE call_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "insert"  ON call_requests FOR INSERT WITH CHECK (true);
CREATE POLICY "reads"   ON call_requests FOR SELECT USING (auth.role() = 'service_role');
CREATE POLICY "deletes" ON call_requests FOR DELETE USING (auth.role() = 'service_role');
```

---

## How it works

- The admin panel sends a `POST` to `https://cnzsytyjsenvyemmvwzv.supabase.co/functions/v1/broadcast-sms`
- The Bearer token is your **Supabase service role key** (stored in localStorage when you enter your admin PIN)
- The function filters contacts to phone-shaped strings (7-20 chars, digits/spaces/+/-/parens)
- Assumes `+1` prefix (Canada/US) if no `+` present
- Returns `{ sent, skipped, errors }` — displayed in the admin panel

---

## Testing

You can test with curl from terminal:

```bash
curl -X POST https://cnzsytyjsenvyemmvwzv.supabase.co/functions/v1/broadcast-sms \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message": "test message"}'
```
