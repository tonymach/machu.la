// ================================================================
// machu.la — admin-ui (serves complete admin panel as ES module)
// ================================================================
// Returns the entire admin panel HTML + JS as a single JavaScript file
// that injects into the page and initializes the admin interface.
//
// Auth: Authorization: Bearer <service_role_key>
// Validates key by attempting a Supabase query.
// ================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')      ?? ''
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const authHeader = req.headers.get('Authorization') ?? ''
  const key = authHeader.replace('Bearer ', '').trim()
  if (!key) return new Response('Unauthorized', { status: 401, headers: CORS })

  // Validate key by attempting a real Supabase query
  const sb = createClient(SUPABASE_URL, key)
  const { error } = await sb.from('pins').select('code').limit(1)
  if (error && (error.code === 'PGRST301' || error.message?.includes('JWT'))) {
    return new Response('Unauthorized', { status: 401, headers: CORS })
  }

  const adminJS = `
// Admin panel is injected and initialized
(function() {
  const SUPABASE_URL = '${SUPABASE_URL}';
  const SUPABASE_ANON = '${SUPABASE_ANON_KEY}';

  // Inject HTML into admin-main
  document.getElementById('admin-main').innerHTML = \`
    <div class="admin-tabs">
        <button class="admin-tab active" data-tab="question">Question</button>
        <button class="admin-tab" data-tab="pins">PINs</button>
        <button class="admin-tab" data-tab="results">Results</button>
        <button class="admin-tab" data-tab="subscribers">Subscribers</button>
        <button class="admin-tab" data-tab="network">Network</button>
    </div>

    <!-- Question tab -->
    <div class="admin-panel active" id="admin-tab-question">
        <div class="admin-section">
            <div class="admin-label">Active Question</div>
            <div class="admin-current-q" id="admin-current-q">Loading...</div>
        </div>
        <div class="admin-section">
            <div class="admin-label">Set New Question</div>
            <input type="text" class="admin-input" id="admin-new-q" placeholder="What's the decision?">
            <div id="admin-options-list" style="margin-bottom:.5rem;"></div>
            <button class="admin-btn" id="admin-add-option">+ Option</button>
            <button class="admin-btn primary" id="admin-set-question" style="float:right;">Make Active ↗</button>
            <div style="clear:both;"></div>
        </div>
        <div class="admin-section">
            <div class="admin-label">Question History</div>
            <div id="admin-q-history"><div style="color:#2a5a2a;font-size:.72rem;font-style:italic;">Loading...</div></div>
        </div>
        <!-- ── Notify subscribers ── -->
        <div class="admin-section">
            <div class="admin-label" style="color:#FFD700;letter-spacing:2px;">📣 Notify Subscribers</div>
            <div style="color:#4a7a4a;font-size:.72rem;margin-bottom:.75rem;font-family:monospace;line-height:1.6;">Each person gets this message with their PIN auto-inserted where you put <span style="color:#c8ffc8;">{pin}</span>. No PIN on file? They still get the message without it.</div>
            <textarea id="notify-msg" style="width:100%;background:#040d04;border:1px solid #1a3a1a;color:#c8ffc8;font-family:monospace;font-size:.82rem;padding:.65rem;border-radius:4px;resize:vertical;min-height:90px;box-sizing:border-box;outline:none;"></textarea>
            <div style="display:flex;align-items:center;gap:.75rem;margin-top:.55rem;flex-wrap:wrap;">
                <button class="admin-btn" id="notify-btn" onclick="notifyDecision()" style="border-color:#FFD700;color:#FFD700;">📣 Send to All</button>
                <span id="notify-status" style="font-family:monospace;font-size:.72rem;color:#4a7a4a;"></span>
            </div>
        </div>
    </div>

    <!-- Pins tab -->
    <div class="admin-panel" id="admin-tab-pins">
        <div class="admin-section">
            <div class="admin-label">Create PIN</div>
            <div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:flex-end;">
                <div style="flex:1;min-width:120px;">
                    <div style="font-size:.62rem;color:#2a5a2a;margin-bottom:.3rem;letter-spacing:1px;">LABEL (who is this for?)</div>
                    <input type="text" class="admin-input" id="admin-pin-label" placeholder="e.g. Sarah" style="margin:0;">
                </div>
                <div style="width:120px;">
                    <div style="font-size:.62rem;color:#2a5a2a;margin-bottom:.3rem;letter-spacing:1px;">PIN CODE (blank = auto)</div>
                    <input type="text" class="admin-input" id="admin-pin-code" placeholder="auto" maxlength="8" style="margin:0;">
                </div>
                <div style="flex:1;min-width:140px;">
                    <div style="font-size:.62rem;color:#2a5a2a;margin-bottom:.3rem;letter-spacing:1px;">PHONE FOR SMS (optional)</div>
                    <input type="text" class="admin-input" id="admin-pin-phone" placeholder="+1 647… or +49 176…" style="margin:0;">
                </div>
                <button class="admin-btn primary" id="admin-create-pin">Create ↗</button>
            </div>
            <div style="font-size:.62rem;color:#1a4a1a;margin-top:.4rem;font-family:monospace;">Adding a phone number auto-subscribes them to SMS broadcasts.</div>
        </div>
        <div class="admin-section">
            <div class="admin-label">All PINs</div>
            <table class="admin-table">
                <thead><tr><th>Code</th><th>Label</th><th>Votes Cast</th><th>Created</th><th></th></tr></thead>
                <tbody id="admin-pins-tbody"><tr><td colspan="5" style="color:#2a5a2a;font-style:italic;">Loading...</td></tr></tbody>
            </table>
        </div>
    </div>

    <!-- Results tab -->
    <div class="admin-panel" id="admin-tab-results">
        <div class="admin-section" style="margin-bottom:.8rem;">
            <select id="admin-results-filter" class="admin-input" style="margin-bottom:0;">
                <option value="">All questions</option>
            </select>
        </div>
        <div id="admin-pie-section" class="admin-section"></div>
        <div class="admin-section">
            <div class="admin-label">Votes Cast</div>
            <div style="overflow-x:auto;">
                <table class="admin-table">
                    <thead><tr><th>Voter</th><th>Question</th><th>Choice</th><th>Close</th><th>Expert</th><th>Reasoning</th><th>When</th><th></th></tr></thead>
                    <tbody id="admin-results-tbody"><tr><td colspan="8" style="color:#2a5a2a;font-style:italic;">Loading...</td></tr></tbody>
                </table>
            </div>
        </div>
    </div>

    <!-- Subscribers tab -->
    <div class="admin-panel" id="admin-tab-subscribers">
        <!-- SMS Broadcast -->
        <div class="admin-section">
            <div class="admin-label" style="color:#FFD700;letter-spacing:2px;">📡 SMS Broadcast</div>
            <div style="color:#4a7a4a;font-size:.72rem;margin-bottom:.75rem;font-family:monospace;line-height:1.6;">Sends to all active subscribers. Flexible — raw text or include a link.</div>
            <textarea id="broadcast-msg" style="width:100%;background:#040d04;border:1px solid #1a3a1a;color:#c8ffc8;font-family:monospace;font-size:.82rem;padding:.65rem;border-radius:4px;resize:vertical;min-height:90px;box-sizing:border-box;outline:none;" placeholder="Type your drop... or include a link for richer posts."></textarea>
            <div style="display:flex;align-items:center;gap:.75rem;margin-top:.55rem;flex-wrap:wrap;">
                <button class="admin-btn" id="broadcast-btn" onclick="broadcastSMS()" style="border-color:#FFD700;color:#FFD700;">↗ Send SMS</button>
                <span id="broadcast-status" style="font-family:monospace;font-size:.72rem;color:#4a7a4a;"></span>
            </div>
        </div>
        <!-- Quick-add subscriber -->
        <div class="admin-section">
            <div class="admin-label" style="color:#4ADE80;letter-spacing:2px;">+ Quick Add</div>
            <div style="color:#4a7a4a;font-size:.68rem;margin-bottom:.6rem;font-family:monospace;">Or just text your Twilio number: "Sarah Chen +16475551234 met at that rooftop thing"</div>
            <div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:flex-end;">
                <div style="flex:1;min-width:110px;">
                    <div style="font-size:.6rem;color:#2a5a2a;margin-bottom:.25rem;letter-spacing:1px;">NAME</div>
                    <input type="text" class="admin-input" id="qa-name" placeholder="Sarah Chen" style="margin:0;">
                </div>
                <div style="flex:1;min-width:130px;">
                    <div style="font-size:.6rem;color:#2a5a2a;margin-bottom:.25rem;letter-spacing:1px;">PHONE</div>
                    <input type="text" class="admin-input" id="qa-phone" placeholder="+1 647… or +49 176…" style="margin:0;">
                </div>
                <div style="flex:2;min-width:160px;">
                    <div style="font-size:.6rem;color:#2a5a2a;margin-bottom:.25rem;letter-spacing:1px;">HOW YOU MET</div>
                    <input type="text" class="admin-input" id="qa-how-met" placeholder="rooftop thing on King St" style="margin:0;">
                </div>
                <button class="admin-btn primary" id="qa-submit">Add ↗</button>
            </div>
            <div id="qa-status" style="font-family:monospace;font-size:.72rem;color:#4a7a4a;margin-top:.4rem;min-height:1.2rem;"></div>
        </div>
        <!-- Subscriber list -->
        <div class="admin-section">
            <div class="admin-label" style="color:#4ADE80;letter-spacing:2px;">📋 Subscribers <span id="sub-count" style="color:#2a5a2a;font-size:.72rem;"></span></div>
            <div style="overflow-x:auto;">
                <table class="admin-table">
                    <thead><tr><th>Name</th><th>Phone</th><th>PIN</th><th>How Met</th><th>Status</th><th>Added</th><th></th></tr></thead>
                    <tbody id="admin-subs-tbody"><tr><td colspan="7" style="color:#2a5a2a;font-style:italic;">Loading...</td></tr></tbody>
                </table>
            </div>
        </div>
        <!-- Inbound replies -->
        <div class="admin-section">
            <div class="admin-label" style="color:#60A5FA;letter-spacing:2px;">💬 Replies</div>
            <div style="overflow-x:auto;">
                <table class="admin-table">
                    <thead><tr><th>From</th><th>Message</th><th>When</th><th></th></tr></thead>
                    <tbody id="admin-replies-tbody"><tr><td colspan="4" style="color:#2a5a2a;font-style:italic;">Loading...</td></tr></tbody>
                </table>
            </div>
        </div>
    </div>

    <!-- Network tab -->
    <div class="admin-panel" id="admin-tab-network">
        <div class="admin-section">
            <div class="admin-label" style="color:#4ADE80;letter-spacing:2px;">📞 Call Requests</div>
            <div style="overflow-x:auto;">
                <table class="admin-table">
                    <thead><tr><th>Name</th><th>Contact</th><th>Asked</th><th>When</th><th></th></tr></thead>
                    <tbody id="admin-calls-tbody"><tr><td colspan="5" style="color:#2a5a2a;font-style:italic;">Loading...</td></tr></tbody>
                </table>
            </div>
        </div>
        <div class="admin-section">
            <div class="admin-label">Help Requests</div>
            <div style="overflow-x:auto;">
                <table class="admin-table">
                    <thead><tr><th>Name</th><th>Email</th><th>Need</th><th>Offer</th><th>When</th><th></th></tr></thead>
                    <tbody id="admin-network-tbody"><tr><td colspan="6" style="color:#2a5a2a;font-style:italic;">Loading...</td></tr></tbody>
                </table>
            </div>
        </div>
    </div>
  \`;

  document.getElementById('admin-float-btn').style.display = 'block';

  // Admin helper functions
  async function adminDataGet(resource) {
    const key = window.getAdminKey(); if (!key) return null;
    const res = await fetch(\`\${SUPABASE_URL}/functions/v1/admin-data?resource=\${resource}\`, {
        headers: { 'Authorization': \`Bearer \${key}\` }
    });
    if (!res.ok) return null;
    return res.json();
  }

  async function adminDataPost(body) {
    const key = window.getAdminKey(); if (!key) return { error: 'No admin session' };
    const res = await fetch(\`\${SUPABASE_URL}/functions/v1/admin-data\`, {
        method: 'POST',
        headers: { 'Authorization': \`Bearer \${key}\`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    return res.json();
  }

  // Crypto-secure PIN generator
  function generateSecurePin() {
    const bytes = new Uint8Array(4);
    crypto.getRandomValues(bytes);
    const num = new DataView(bytes.buffer).getUint32(0);
    return num.toString(36).slice(-6).toUpperCase().padStart(6, '0');
  }

  // Client-side phone normaliser
  function normalisePhoneClient(raw) {
    if (!raw) return null;
    const stripped = raw.trim().replace(/[\\s\\-\\.\\(\\)]/g, '');
    const digits = stripped.replace(/^\\+/, '');
    if (!/^\\d{7,15}$/.test(digits)) return null;
    if (stripped.startsWith('+')) return stripped;
    if (digits.length === 10) return \`+1\${digits}\`;
    if (digits.length === 11 && digits.startsWith('1')) return \`+\${digits}\`;
    return \`+\${digits}\`;
  }

  // Get admin client
  function getSbAdmin() {
    if (window._sbAdmin) return window._sbAdmin;
    const k = window.getAdminKey();
    if (!k || SUPABASE_URL.includes('REPLACE')) return null;
    window._sbAdmin = supabase.createClient(SUPABASE_URL, k);
    return window._sbAdmin;
  }

  // HTML escape helper
  function escHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  // Load admin tab
  async function loadAdminTab(tab) {
    const admin = getSbAdmin(); if (!admin) return;
    if (tab === 'question') {
        const { data: active } = await admin.from('board_questions').select('*').eq('active', true).maybeSingle();
        const el = document.getElementById('admin-current-q');
        el.innerHTML = active
            ? \`<strong>\${escHtml(active.question)}</strong><br><span style="color:#2a5a2a;font-size:.75rem;">\${active.options.map(o=>\`\${(o.label||o.id.toUpperCase())}: \${o.text}\`).join(' &nbsp;·&nbsp; ')}</span>\`
            : '<span style="color:#2a5a2a;font-style:italic;">No active question set yet.</span>';
        const notifyEl = document.getElementById('notify-msg');
        if (notifyEl && active) {
            const opts = active.options.map((o,i) => \`\${i+1} — \${o.text}\`).join(', ');
            notifyEl.value = \`I've got a new decision I actually want your take on.\n\n"\${active.question}"\n\nYour options: \${opts}\n\nVote at machu.la — your PIN is {pin}\`;
        } else if (notifyEl && !active) {
            notifyEl.value = \`I've got a new decision I actually want your take on. Head to machu.la to weigh in — your PIN is {pin}\`;
        }
        const { data: allQs } = await admin.from('board_questions')
            .select('id, question, active, options, created_at, votes(count)')
            .order('created_at', { ascending: false });
        const histEl = document.getElementById('admin-q-history');
        if (histEl) {
            if (!allQs || !allQs.length) {
                histEl.innerHTML = '<div style="color:#2a5a2a;font-size:.72rem;font-style:italic;">No questions yet.</div>';
            } else {
                histEl.innerHTML = allQs.map(q => {
                    const votes = q.votes?.[0]?.count ?? 0;
                    const isActive = !!q.active;
                    return \`<div class="admin-q-history-item\${isActive?' active-q':''}" data-qid="\${q.id}">
                        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem;">
                            <div style="flex:1;min-width:0;">
                                <div style="font-size:.8rem;color:\${isActive?'#4ADE80':'#a0c8a0'};line-height:1.5;margin-bottom:.25rem;">\${escHtml(q.question)}</div>
                                <div style="font-size:.63rem;color:#2a5a2a;">\${votes} vote\${votes!==1?'s':''} &nbsp;·&nbsp; \${new Date(q.created_at).toLocaleDateString()}</div>
                            </div>
                            <div style="flex-shrink:0;display:flex;gap:.3rem;flex-wrap:wrap;justify-content:flex-end;padding-top:.1rem;">
                                \${isActive
                                    ? '<span style="color:#4ADE80;font-size:.6rem;letter-spacing:1px;font-family:monospace;">ACTIVE</span>'
                                    : \`<button class="admin-btn" style="font-size:.62rem;padding:.25rem .5rem;" onclick="activateQuestion('\${q.id}')">Activate</button>\`}
                                <button class="admin-btn" style="font-size:.62rem;padding:.25rem .5rem;" onclick="editQuestion('\${q.id}')">Edit</button>
                                <button class="admin-btn" style="font-size:.62rem;padding:.25rem .5rem;border-color:#ff4444;color:#ff8888;" onclick="deleteQuestion('\${q.id}',\${escHtml(JSON.stringify(q.question))})">Del</button>
                            </div>
                        </div>
                    </div>\`;
                }).join('');
            }
        }
    } else if (tab === 'pins') {
        const { data } = await admin.from('pins').select('*, votes(count)').order('created_at', { ascending: false });
        const tbody = document.getElementById('admin-pins-tbody');
        tbody.innerHTML = (!data || !data.length)
            ? '<tr><td colspan="5" style="color:#2a5a2a;font-style:italic;">No pins yet — create one above.</td></tr>'
            : data.map(p => {
                const voteCount = p.votes?.[0]?.count ?? 0;
                return \`<tr>
                <td><code style="color:#4ADE80;">\${escHtml(p.code)}</code></td>
                <td id="pin-label-\${p.id}">\${escHtml(p.label||'—')}</td>
                <td><span class="admin-badge \${voteCount>0?'used':'unused'}">\${voteCount} vote\${voteCount!==1?'s':''}</span></td>
                <td style="color:#2a5a2a;">\${new Date(p.created_at).toLocaleDateString()}</td>
                <td style="white-space:nowrap;">
                    <button class="admin-btn" style="font-size:.62rem;padding:.2rem .5rem;" onclick="editPin('\${p.id}',\${escHtml(JSON.stringify(p.label||''))})">Edit</button>
                    <button class="admin-btn" style="font-size:.62rem;padding:.2rem .5rem;border-color:#ff4444;color:#ff8888;" onclick="deletePin('\${p.id}',\${escHtml(JSON.stringify(p.code))})">Del</button>
                </td>
              </tr>\`;}).join('');
    } else if (tab === 'results') {
        const { data: questions } = await admin.from('board_questions')
            .select('id, question, active').order('created_at', { ascending: false });
        const filterEl = document.getElementById('admin-results-filter');
        const prevFilter = filterEl?.value || '';
        if (filterEl) {
            filterEl.innerHTML = '<option value="">All questions</option>' +
                (questions||[]).map(q => \`<option value="\${q.id}"\${q.active?' style="color:#4ADE80;"':''}'\${prevFilter===q.id?' selected':''}>\${escHtml(q.question.slice(0,55))}\${q.active?' ★':''}</option>\`).join('');
            filterEl.onchange = () => loadAdminTab('results');
        }
        const currentFilter = filterEl?.value || '';
        let query = admin.from('votes')
            .select('*, pins(label,code), board_questions(id,question,options)')
            .order('created_at', { ascending: false });
        if (currentFilter) query = query.eq('question_id', currentFilter);
        const { data: votes } = await query;
        const pieSection = document.getElementById('admin-pie-section');
        if (pieSection && votes && votes.length) {
            const qMap = {};
            votes.forEach(v => {
                const qid = v.question_id;
                if (!qMap[qid]) qMap[qid] = { question: v.board_questions?.question || '?', counts: {} };
                qMap[qid].counts[v.choice_text] = (qMap[qid].counts[v.choice_text] || 0) + 1;
            });
            pieSection.innerHTML = '<div class="admin-label" style="margin-bottom:.6rem;">Vote Breakdown</div>' +
                Object.values(qMap).map(qd => {
                    const pieData = Object.entries(qd.counts).map(([label, count]) => ({ label, count }));
                    return \`<div style="margin-bottom:1rem;">
                        <div style="font-size:.7rem;color:#3a5a3a;margin-bottom:.5rem;font-family:monospace;">\${escHtml(qd.question)}</div>
                        \${renderPieChart(pieData)}
                    </div>\`;
                }).join('');
        } else if (pieSection) {
            pieSection.innerHTML = '';
        }
        const tbody = document.getElementById('admin-results-tbody');
        const dotStr = n => n ? '●'.repeat(n) + '○'.repeat(5 - n) : '—';
        tbody.innerHTML = (!votes || !votes.length)
            ? '<tr><td colspan="8" style="color:#2a5a2a;font-style:italic;">No votes yet.</td></tr>'
            : votes.map(v => \`<tr>
                <td>\${escHtml(v.pins?.label || v.pins?.code || '?')}</td>
                <td style="color:#3a5a3a;font-size:.68rem;max-width:160px;word-break:break-word;">\${escHtml((v.board_questions?.question||'—').slice(0,45))}\${(v.board_questions?.question||'').length>45?'…':''}</td>
                <td style="color:#4ADE80;">\${escHtml(v.choice_text)}</td>
                <td style="font-size:.68rem;letter-spacing:1px;color:#4ADE80;white-space:nowrap;">\${dotStr(v.closeness)}</td>
                <td style="font-size:.68rem;letter-spacing:1px;color:#4ADE80;white-space:nowrap;">\${dotStr(v.expertise)}</td>
                <td style="color:#a0c8a0;font-size:.7rem;max-width:180px;word-break:break-word;">\${v.justification ? escHtml(v.justification) : '<span style="color:#2a4a2a;">—</span>'}</td>
                <td style="color:#2a5a2a;white-space:nowrap;">\${new Date(v.created_at).toLocaleString()}</td>
                <td><button class="admin-btn" style="font-size:.6rem;padding:.15rem .45rem;border-color:#ff4444;color:#ff8888;" onclick="deleteVote('\${v.id}')">✕</button></td>
              </tr>\`).join('');
    } else if (tab === 'network') {
        const { data: calls } = await admin.from('call_requests').select('*').order('created_at', { ascending: false });
        const callsTbody = document.getElementById('admin-calls-tbody');
        callsTbody.innerHTML = (!calls?.length)
            ? '<tr><td colspan="5" style="color:#2a5a2a;font-style:italic;">No calls yet.</td></tr>'
            : calls.map(r => \`<tr>
                <td style="color:#4ADE80;font-weight:bold;">\${escHtml(r.name||'—')}</td>
                <td style="color:#d0f0d0;">\${escHtml(r.contact||'—')}</td>
                <td style="color:#4a7a4a;font-size:.7rem;max-width:180px;word-break:break-word;">\${escHtml(r.trigger_question||'—')}</td>
                <td style="white-space:nowrap;font-size:.68rem;color:#2a5a2a;">\${new Date(r.created_at).toLocaleDateString()}</td>
                <td><button class="admin-btn" style="font-size:.6rem;padding:.15rem .45rem;border-color:#ff4444;color:#ff8888;" onclick="deleteCall('\${r.id}')">✕</button></td>
            </tr>\`).join('');
        const { data: reqs } = await admin.from('network_requests').select('*').order('created_at', { ascending: false });
        const tbody = document.getElementById('admin-network-tbody');
        tbody.innerHTML = (!reqs?.length)
            ? '<tr><td colspan="6" style="color:#2a5a2a;font-style:italic;">No requests yet.</td></tr>'
            : reqs.map(r => \`<tr>
                <td>\${escHtml(r.name||'—')}</td>
                <td style="font-size:.72rem;">\${escHtml(r.email||'—')}</td>
                <td style="max-width:200px;word-break:break-word;">\${escHtml(r.need||'—')}</td>
                <td style="max-width:160px;word-break:break-word;color:#4a7a4a;">\${escHtml(r.offer||'—')}</td>
                <td style="white-space:nowrap;font-size:.68rem;color:#2a5a2a;">\${new Date(r.created_at).toLocaleDateString()}</td>
                <td><button class="admin-btn" style="font-size:.6rem;padding:.15rem .45rem;border-color:#ff4444;color:#ff8888;" onclick="deleteRequest('\${r.id}')">✕</button></td>
            </tr>\`).join('');
    } else if (tab === 'subscribers') {
        const subs    = await adminDataGet('subscribers');
        const replies = await adminDataGet('replies');
        const subsTbody    = document.getElementById('admin-subs-tbody');
        const repliesTbody = document.getElementById('admin-replies-tbody');
        const countEl      = document.getElementById('sub-count');
        const activeCount  = (subs ?? []).filter(s => s.active).length;
        if (countEl) countEl.textContent = \`(\${activeCount} active / \${(subs??[]).length} total)\`;
        subsTbody.innerHTML = (!subs?.length)
            ? '<tr><td colspan="7" style="color:#2a5a2a;font-style:italic;">No subscribers yet — use quick-add above, or text your Twilio number.</td></tr>'
            : subs.map(r => \`<tr>
                <td style="color:#4ADE80;font-weight:bold;">\${escHtml(r.name||'—')}</td>
                <td style="color:#d0f0d0;font-family:monospace;font-size:.78rem;">\${escHtml(r.phone||'—')}</td>
                <td style="font-family:monospace;font-size:.78rem;color:#FFD700;letter-spacing:1px;">\${escHtml(r.pin_code||'—')}</td>
                <td style="color:#4a7a4a;font-size:.72rem;max-width:180px;word-break:break-word;font-style:italic;">\${escHtml(r.how_met||'—')}</td>
                <td><span style="color:\${r.active?'#4ADE80':'#ff8888'};font-size:.72rem;font-family:monospace;">\${r.active?'ACTIVE':'PAUSED'}</span></td>
                <td style="white-space:nowrap;font-size:.68rem;color:#2a5a2a;">\${new Date(r.created_at).toLocaleDateString()}</td>
                <td style="display:flex;gap:.3rem;flex-wrap:wrap;">
                    <button class="admin-btn" style="font-size:.6rem;padding:.15rem .45rem;" onclick="toggleSub('\${r.id}')">\${r.active?'⏸':'▶'}</button>
                    <button class="admin-btn" style="font-size:.6rem;padding:.15rem .45rem;border-color:#ff4444;color:#ff8888;" onclick="deleteSub('\${r.id}')">✕</button>
                </td>
            </tr>\`).join('');
        repliesTbody.innerHTML = (!replies?.length)
            ? '<tr><td colspan="4" style="color:#2a5a2a;font-style:italic;">No replies yet.</td></tr>'
            : replies.map(r => \`<tr>
                <td style="font-family:monospace;font-size:.75rem;color:#4ADE80;">\${escHtml(r.from_number||'—')}</td>
                <td style="max-width:240px;word-break:break-word;">\${escHtml(r.body||'—')}</td>
                <td style="white-space:nowrap;font-size:.68rem;color:#2a5a2a;">\${new Date(r.received_at).toLocaleString()}</td>
                <td><button class="admin-btn" style="font-size:.6rem;padding:.15rem .45rem;border-color:#ff4444;color:#ff8888;" onclick="deleteReply('\${r.id}')">✕</button></td>
            </tr>\`).join('');
    }
  }

  // Toggle subscriber
  async function toggleSub(id) {
    await adminDataPost({ resource: 'subscribers', action: 'toggle', id });
    await loadAdminTab('subscribers');
  }

  // Delete subscriber
  async function deleteSub(id) {
    if (!confirm('Remove this subscriber?')) return;
    await adminDataPost({ resource: 'subscribers', action: 'delete', id });
    await loadAdminTab('subscribers');
  }

  // Delete reply
  async function deleteReply(id) {
    await adminDataPost({ resource: 'replies', action: 'delete', id });
    await loadAdminTab('subscribers');
  }

  // Delete request
  async function deleteRequest(id) {
    const admin = getSbAdmin(); if (!admin) return;
    if (!confirm('Delete this request?')) return;
    await admin.from('network_requests').delete().eq('id', id);
    await loadAdminTab('network');
  }

  // Delete call
  async function deleteCall(id) {
    const admin = getSbAdmin(); if (!admin) return;
    if (!confirm('Delete this call request?')) return;
    await admin.from('call_requests').delete().eq('id', id);
    await loadAdminTab('network');
  }

  // Notify decision
  async function notifyDecision() {
    const template = document.getElementById('notify-msg').value.trim();
    if (!template) { document.getElementById('notify-status').textContent = 'Write a message first.'; return; }
    const statusEl = document.getElementById('notify-status');
    const btn = document.getElementById('notify-btn');
    const secret = window.getAdminKey();
    if (!secret) { statusEl.style.color = '#ff8888'; statusEl.textContent = '✗ No admin key. Re-enter PIN.'; return; }
    if (!confirm(\`Send personalized decision notification to all active subscribers?\\n\\nTemplate:\\n"\${template.slice(0,120)}\${template.length>120?'…':''}\"\`)) return;
    btn.disabled = true; btn.textContent = '...';
    statusEl.style.color = '#4a7a4a'; statusEl.textContent = 'Sending...';
    try {
        const res = await fetch(\`\${SUPABASE_URL}/functions/v1/broadcast-sms\`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': \`Bearer \${secret}\` },
            body: JSON.stringify({ mode: 'decision', template })
        });
        const data = await res.json();
        if (res.ok) {
            statusEl.style.color = '#4ADE80';
            statusEl.textContent = \`✓ Sent to \${data.sent} subscriber\${data.sent!==1?'s':''}\${data.skipped?\`, \${data.skipped} no phone\`:''}\`;
        } else {
            statusEl.style.color = '#ff8888';
            statusEl.textContent = \`✗ \${data.error || 'Unknown error'}\`;
        }
    } catch (err) {
        statusEl.style.color = '#ff8888';
        statusEl.textContent = \`✗ \${err.message}\`;
    }
    btn.disabled = false; btn.textContent = '📣 Send to All';
  }

  // Broadcast SMS
  async function broadcastSMS() {
    const msg = document.getElementById('broadcast-msg').value.trim();
    if (!msg) { document.getElementById('broadcast-status').textContent = 'Write something first.'; return; }
    const statusEl = document.getElementById('broadcast-status');
    const btn = document.getElementById('broadcast-btn');
    const secret = window.getAdminKey();
    if (!secret) { statusEl.style.color = '#ff8888'; statusEl.textContent = '✗ No admin key found. Re-enter PIN.'; return; }
    if (!confirm(\`Send to all contacts?\\n\\n"\${msg}"\`)) return;
    btn.disabled = true; btn.textContent = '...';
    statusEl.style.color = '#4a7a4a'; statusEl.textContent = 'Sending...';
    try {
        const res = await fetch(\`\${SUPABASE_URL}/functions/v1/broadcast-sms\`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': \`Bearer \${secret}\`
            },
            body: JSON.stringify({ message: msg })
        });
        const data = await res.json();
        if (res.ok) {
            statusEl.style.color = '#4ADE80';
            statusEl.textContent = \`✓ Sent to \${data.sent} contact\${data.sent !== 1 ? 's' : ''}\${data.skipped ? \`, \${data.skipped} skipped (non-phone)\` : ''}\`;
            document.getElementById('broadcast-msg').value = '';
        } else {
            statusEl.style.color = '#ff8888';
            statusEl.textContent = \`✗ \${data.error || 'Unknown error'}\`;
        }
    } catch (err) {
        statusEl.style.color = '#ff8888';
        statusEl.textContent = \`✗ \${err.message}\`;
    }
    btn.disabled = false; btn.textContent = '↗ Send SMS';
  }

  // Pie chart renderer
  function renderPieChart(data) {
    const COLORS = ['#4ADE80','#FFD700','#60A5FA','#F472B6','#A78BFA','#34D399','#FB923C'];
    const total = data.reduce((s, d) => s + d.count, 0);
    if (!total) return '<span style="color:#2a5a2a;font-size:.72rem;">No votes yet</span>';
    const cx = 56, cy = 56, r = 50;
    let angle = -Math.PI / 2;
    const segs = data.map((d, i) => {
        const frac = d.count / total;
        const a0 = angle, a1 = angle + frac * 2 * Math.PI;
        angle = a1;
        if (frac >= 0.9999) {
            return { path: \`M \${cx} \${cy-r} A \${r} \${r} 0 0 1 \${cx} \${cy+r} A \${r} \${r} 0 0 1 \${cx} \${cy-r} Z\`, color: COLORS[i % COLORS.length], label: d.label, count: d.count, pct: 100 };
        }
        const x1 = cx + r * Math.cos(a0), y1 = cy + r * Math.sin(a0);
        const x2 = cx + r * Math.cos(a1), y2 = cy + r * Math.sin(a1);
        const large = frac > 0.5 ? 1 : 0;
        return { path: \`M \${cx} \${cy} L \${x1} \${y1} A \${r} \${r} 0 \${large} 1 \${x2} \${y2} Z\`, color: COLORS[i % COLORS.length], label: d.label, count: d.count, pct: Math.round(frac * 100) };
    });
    const paths = segs.map(s => \`<path d="\${s.path}" fill="\${s.color}" stroke="#030303" stroke-width="1.5"/>\`).join('');
    const legend = segs.map(s => \`<div style="display:flex;align-items:center;gap:.35rem;margin-bottom:.25rem;">
        <span style="width:9px;height:9px;background:\${s.color};border-radius:50%;flex-shrink:0;"></span>
        <span style="font-size:.7rem;color:#a0c8a0;">\${escHtml(s.label)}: \${s.count} <span style="color:#4ADE80;">(\${s.pct}%)</span></span>
    </div>\`).join('');
    return \`<div style="display:flex;align-items:center;gap:1.2rem;flex-wrap:wrap;">
        <svg width="112" height="112" viewBox="0 0 112 112" style="flex-shrink:0;">
            \${paths}
            <text x="\${cx}" y="\${cy+4}" text-anchor="middle" fill="#c8ffc8" font-family="monospace" font-size="11">\${total}</text>
        </svg>
        <div>\${legend}</div>
    </div>\`;
  }

  // Activate question
  async function activateQuestion(qid) {
    const admin = getSbAdmin(); if (!admin) return;
    await admin.from('board_questions').update({ active: false }).neq('id', '00000000-0000-0000-0000-000000000000');
    await admin.from('board_questions').update({ active: true }).eq('id', qid);
    await loadAdminTab('question');
  }

  // Edit question
  async function editQuestion(qid) {
    const admin = getSbAdmin(); if (!admin) return;
    const { data: q } = await admin.from('board_questions').select('*').eq('id', qid).single();
    if (!q) return;
    const item = document.querySelector(\`[data-qid="\${qid}"]\`);
    if (!item) return;
    item._editOpts = JSON.parse(JSON.stringify(q.options));
    const optsHtml = q.options.map((o, i) => \`
        <div style="display:flex;gap:.35rem;margin-bottom:.3rem;align-items:center;">
            <span style="color:#2a5a2a;font-size:.65rem;min-width:22px;font-family:monospace;">\${(o.label||o.id.toUpperCase())}</span>
            <input class="admin-input" style="margin:0;flex:1;font-size:.78rem;" value="\${escHtml(o.text)}" data-opt-idx="\${i}">
        </div>\`).join('');
    item.innerHTML = \`
        <div style="margin-bottom:.4rem;">
            <div style="font-size:.6rem;color:#2a5a2a;letter-spacing:1px;margin-bottom:.25rem;">QUESTION</div>
            <input class="admin-input" id="eq-text-\${qid}" value="\${escHtml(q.question)}" style="margin:0;">
        </div>
        <div style="margin-bottom:.5rem;">
            <div style="font-size:.6rem;color:#2a5a2a;letter-spacing:1px;margin-bottom:.25rem;">OPTIONS</div>
            \${optsHtml}
        </div>
        <div style="display:flex;gap:.4rem;">
            <button class="admin-btn primary" onclick="saveQuestion('\${qid}')">Save ↗</button>
            <button class="admin-btn" style="opacity:.6;" onclick="loadAdminTab('question')">Cancel</button>
        </div>\`;
  }

  // Save question
  async function saveQuestion(qid) {
    const admin = getSbAdmin(); if (!admin) return;
    const item = document.querySelector(\`[data-qid="\${qid}"]\`);
    if (!item || !item._editOpts) return;
    const newQ = document.getElementById(\`eq-text-\${qid}\`)?.value.trim();
    if (!newQ) { alert('Question text is required.'); return; }
    const optInputs = item.querySelectorAll('[data-opt-idx]');
    const newOpts = item._editOpts.map((o, i) => ({ ...o, text: optInputs[i]?.value.trim() || o.text }));
    const saveBtn = item.querySelector('button');
    if (saveBtn) { saveBtn.textContent = 'Saving...'; saveBtn.disabled = true; }
    const { error } = await admin.from('board_questions').update({ question: newQ, options: newOpts }).eq('id', qid);
    if (error) { alert('Error: ' + error.message); if (saveBtn) { saveBtn.textContent = 'Save ↗'; saveBtn.disabled = false; } }
    else await loadAdminTab('question');
  }

  // Delete question
  async function deleteQuestion(qid, questionText) {
    if (!confirm(\`Delete this question?\\n\\n"\${questionText}"\\n\\nAll associated votes will also be removed.\`)) return;
    const admin = getSbAdmin(); if (!admin) return;
    await admin.from('votes').delete().eq('question_id', qid);
    const { error } = await admin.from('board_questions').delete().eq('id', qid);
    if (error) alert('Error: ' + error.message);
    else await loadAdminTab('question');
  }

  // Edit PIN
  async function editPin(pinId, currentLabel) {
    const cell = document.getElementById(\`pin-label-\${pinId}\`);
    if (!cell) return;
    cell.innerHTML = \`<input class="admin-input" id="pin-li-\${pinId}" value="\${escHtml(currentLabel)}" style="margin:0;width:100%;font-size:.75rem;" placeholder="Label...">\`;
    const inp = document.getElementById(\`pin-li-\${pinId}\`);
    inp.focus(); inp.select();
    let saved = false;
    async function save() {
        if (saved) return; saved = true;
        const newLabel = inp.value.trim() || null;
        const admin = getSbAdmin(); if (!admin) return;
        await admin.from('pins').update({ label: newLabel }).eq('id', pinId);
        await loadAdminTab('pins');
    }
    inp.addEventListener('blur', save);
    inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); save(); }
        if (e.key === 'Escape') loadAdminTab('pins');
    });
  }

  // Delete PIN
  async function deletePin(pinId, code) {
    if (!confirm(\`Delete PIN "\${code}"?\\n\\nThis will also remove their vote history.\`)) return;
    const admin = getSbAdmin(); if (!admin) return;
    await admin.from('votes').delete().eq('pin_id', pinId);
    const { error } = await admin.from('pins').delete().eq('id', pinId);
    if (error) alert('Error: ' + error.message);
    else await loadAdminTab('pins');
  }

  // Delete vote
  async function deleteVote(voteId) {
    if (!confirm('Remove this vote? This cannot be undone.')) return;
    const admin = getSbAdmin(); if (!admin) return;
    const { error } = await admin.from('votes').delete().eq('id', voteId);
    if (error) alert('Error: ' + error.message);
    else await loadAdminTab('results');
  }

  // Admin options state
  let _adminOpts = [{id:'a',text:''},{id:'b',text:''}];
  let _adminOptsInited = false;

  // Initialize admin options
  function initAdminOptionsList() {
    if (_adminOptsInited) return; _adminOptsInited = true;
    renderAdminOpts();
    document.getElementById('admin-add-option').addEventListener('click', () => {
        if (_adminOpts.length >= 5) return;
        _adminOpts.push({ id: String.fromCharCode(97 + _adminOpts.length), text: '' });
        renderAdminOpts();
    });
    document.getElementById('admin-set-question').addEventListener('click', async function() {
        const admin = getSbAdmin(); if (!admin) return;
        const q = document.getElementById('admin-new-q').value.trim();
        const opts = _adminOpts.filter(o => o.text.trim());
        if (!q)           { alert('Enter a question.'); return; }
        if (opts.length < 2) { alert('Need at least 2 options.'); return; }
        this.textContent = 'Saving...'; this.disabled = true;
        await admin.from('board_questions').update({ active: false }).neq('id', '00000000-0000-0000-0000-000000000000');
        const { error } = await admin.from('board_questions').insert({ question: q, options: opts, active: true });
        if (error) alert('Error: ' + error.message);
        else {
            document.getElementById('admin-new-q').value = '';
            _adminOpts = [{id:'a',text:''},{id:'b',text:''}]; renderAdminOpts();
            await loadAdminTab('question');
        }
        this.textContent = 'Make Active ↗'; this.disabled = false;
    });
    document.getElementById('admin-create-pin').addEventListener('click', async function() {
        const admin = getSbAdmin(); if (!admin) return;
        const label = document.getElementById('admin-pin-label').value.trim();
        let   code  = document.getElementById('admin-pin-code').value.trim().toUpperCase();
        const phone = document.getElementById('admin-pin-phone').value.trim();
        if (!code) code = generateSecurePin();
        this.textContent = 'Creating...'; this.disabled = true;
        const { error } = await admin.from('pins').insert({ code, label: label || null });
        if (error) {
            alert(error.code==='23505' ? 'PIN already exists — try another.' : error.message);
        } else {
            if (phone) {
                const e164 = normalisePhoneClient(phone);
                if (e164) {
                    const subResult = await adminDataPost({
                        resource: 'subscribers', action: 'upsert',
                        data: { name: label || code, phone: e164, pin_code: code }
                    });
                    if (subResult?.error) console.warn('Subscriber insert:', subResult.error);
                }
            }
            document.getElementById('admin-pin-label').value='';
            document.getElementById('admin-pin-code').value='';
            document.getElementById('admin-pin-phone').value='';
            await loadAdminTab('pins');
        }
        this.textContent = 'Create ↗'; this.disabled = false;
    });
  }

  // Render admin options
  function renderAdminOpts() {
    const el = document.getElementById('admin-options-list'); el.innerHTML = '';
    _adminOpts.forEach((opt, i) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:.4rem;margin-bottom:.4rem;align-items:center;';
        row.innerHTML = \`
            <span style="color:#2a5a2a;font-size:.68rem;min-width:50px;letter-spacing:1px;">OPT \${opt.id.toUpperCase()}</span>
            <input type="text" class="admin-input" value="\${escHtml(opt.text)}" placeholder="Option text..." style="margin:0;flex:1;" data-idx="\${i}">
            \${_adminOpts.length > 2 ? \`<button style="background:transparent;border:1px solid #ff4444;color:#ff4444;padding:.3rem .5rem;cursor:pointer;font-family:monospace;font-size:.7rem;border-radius:2px;" data-remove="\${i}">✕</button>\` : ''}\`;
        el.appendChild(row);
    });
    el.querySelectorAll('[data-idx]').forEach(inp => inp.addEventListener('input', function() { _adminOpts[+this.dataset.idx].text = this.value; }));
    el.querySelectorAll('[data-remove]').forEach(btn => btn.addEventListener('click', function() {
        _adminOpts.splice(+this.dataset.remove, 1);
        _adminOpts = _adminOpts.map((o,i) => ({ id: String.fromCharCode(97+i), text: o.text }));
        renderAdminOpts();
    }));
  }

  // Quick-add subscriber handler
  document.addEventListener('DOMContentLoaded', () => {
    const qaBtn = document.getElementById('qa-submit');
    if (!qaBtn) return;
    qaBtn.addEventListener('click', async function() {
        if (!window.getAdminKey()) return;
        const name   = document.getElementById('qa-name').value.trim();
        const phone  = document.getElementById('qa-phone').value.trim();
        const howMet = document.getElementById('qa-how-met').value.trim();
        const status = document.getElementById('qa-status');
        if (!name || !phone) { status.style.color='#ff8888'; status.textContent='Name and phone required.'; return; }
        const e164 = normalisePhoneClient(phone);
        if (!e164) { status.style.color='#ff8888'; status.textContent='Couldn\\'t parse that phone. Try +1 647… or +49 176…'; return; }
        this.disabled = true; this.textContent = '...';
        const result = await adminDataPost({
            resource: 'subscribers', action: 'upsert',
            data: { name, phone: e164, how_met: howMet || null }
        });
        if (result?.error) {
            status.style.color='#ff8888'; status.textContent=\`✗ \${result.error}\`;
        } else {
            const pin = result?.pin ?? '?';
            status.style.color='#4ADE80';
            status.textContent=\`✓ Added \${name} — PIN: \${pin} — share: "machu.la, PIN is \${pin}"\`;
            document.getElementById('qa-name').value='';
            document.getElementById('qa-phone').value='';
            document.getElementById('qa-how-met').value='';
            await loadAdminTab('subscribers');
        }
        this.disabled = false; this.textContent = 'Add ↗';
    });
  });

  // Tab switching
  document.querySelectorAll('.admin-tab').forEach(btn => {
    btn.addEventListener('click', async function() {
        document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
        this.classList.add('active');
        document.getElementById(\`admin-tab-\${this.dataset.tab}\`).classList.add('active');
        await loadAdminTab(this.dataset.tab);
    });
  });

  // Make functions globally available
  window.adminDataGet = adminDataGet;
  window.adminDataPost = adminDataPost;
  window.generateSecurePin = generateSecurePin;
  window.normalisePhoneClient = normalisePhoneClient;
  window.getSbAdmin = getSbAdmin;
  window.loadAdminTab = loadAdminTab;
  window.toggleSub = toggleSub;
  window.deleteSub = deleteSub;
  window.deleteReply = deleteReply;
  window.deleteRequest = deleteRequest;
  window.deleteCall = deleteCall;
  window.notifyDecision = notifyDecision;
  window.broadcastSMS = broadcastSMS;
  window.renderPieChart = renderPieChart;
  window.activateQuestion = activateQuestion;
  window.editQuestion = editQuestion;
  window.saveQuestion = saveQuestion;
  window.deleteQuestion = deleteQuestion;
  window.editPin = editPin;
  window.deletePin = deletePin;
  window.deleteVote = deleteVote;
  window.initAdminOptionsList = initAdminOptionsList;
  window.renderAdminOpts = renderAdminOpts;
  window.escHtml = escHtml;

  // Initialize
  initAdminOptionsList();
  loadAdminTab('question');
})();
`

  return new Response(adminJS, {
    headers: { ...CORS, 'Content-Type': 'application/javascript' }
  })
})
