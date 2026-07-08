/* netlify/functions/track-engagement.js
   Records signed-in visitor dwell beacons and fires a hot-lead alert
   (web push + email + GoHighLevel webhook) once a lead crosses the
   threshold on a property. Verifies the Supabase JWT server-side.

   Required Netlify env vars:
     SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
     RESEND_API_KEY                 (optional — email alerts)
     VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT   (optional — web push)
     ENGAGEMENT_GHL_WEBHOOK_URL     (optional — GHL routing/SMS)
     ENGAGEMENT_ALERT_SECONDS       (optional — default 120)
     ATERRA_FROM_EMAIL              (optional — verified Resend sender)
     ATERRA_SITE_URL                (optional — canonical site URL)
     ADMIN_FALLBACK_EMAIL, ADMIN_FALLBACK_NAME, ADMIN_FALLBACK_USER_ID, ADMIN_FALLBACK_GHL_USER_ID
*/
const webpush = require('web-push');

const SUPABASE_URL   = process.env.SUPABASE_URL || '';
const SR             = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON           = process.env.SUPABASE_ANON_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL     = process.env.ATERRA_FROM_EMAIL || 'Aterra Builders <leads@aterrabuilders.com>';
const SITE           = process.env.ATERRA_SITE_URL || 'https://aterrabuilders.com';
const THRESHOLD      = parseInt(process.env.ENGAGEMENT_ALERT_SECONDS || '120', 10);
const GHL_WEBHOOK    = process.env.ENGAGEMENT_GHL_WEBHOOK_URL || '';
const ADMIN_FALLBACK = {
  name: process.env.ADMIN_FALLBACK_NAME || 'Aterra Builders',
  email: process.env.ADMIN_FALLBACK_EMAIL || '',
  user_id: process.env.ADMIN_FALLBACK_USER_ID || '',
  ghl_user_id: process.env.ADMIN_FALLBACK_GHL_USER_ID || ''
};

const svc  = { apikey: SR, Authorization: 'Bearer ' + SR, 'Content-Type': 'application/json' };
const rest = (path, opts = {}) => fetch(SUPABASE_URL + '/rest/v1/' + path, { ...opts, headers: { ...svc, ...(opts.headers || {}) } });
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json', ...cors }, body: JSON.stringify(obj) });
const esc  = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST')    return json(405, { ok: false, error: 'Method not allowed' });
  if (!SUPABASE_URL || !SR || !ANON)  return json(200, { ok: true, skipped: 'not-configured' });

  // 1) Verify the caller's Supabase session -> trusted user id.
  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return json(200, { ok: true, skipped: 'anon' });
  let user;
  try {
    const uRes = await fetch(SUPABASE_URL + '/auth/v1/user', { headers: { apikey: ANON, Authorization: 'Bearer ' + token } });
    if (!uRes.ok) return json(200, { ok: true, skipped: 'bad-token' });
    user = await uRes.json();
  } catch (_) { return json(200, { ok: true, skipped: 'auth-error' }); }
  if (!user || !user.id) return json(200, { ok: true, skipped: 'no-user' });

  let b; try { b = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { ok: false, error: 'Bad JSON' }); }
  const dwell = Math.max(0, Math.min(7200, parseInt(b.dwell_seconds, 10) || 0));
  const cumulative = Math.max(dwell, Math.min(14400, parseInt(b.cumulative_seconds, 10) || 0));
  const kind = b.listing_id ? 'property' : (b.kind === 'property' ? 'property' : 'page');
  const rec = {
    user_id: user.id,
    path: (b.path || '').slice(0, 400) || null,
    url: (b.url || '').slice(0, 600) || null,
    title: (b.title || '').slice(0, 300) || null,
    listing_id: (b.listing_id || '').toString().slice(0, 120) || null,
    kind, dwell_seconds: dwell
  };

  // 2) Record the beacon.
  try { await rest('page_engagement', { method: 'POST', body: JSON.stringify(rec) }); } catch (_) {}

  // 3) Hot-lead alert.
  if (kind === 'property' && cumulative >= THRESHOLD && rec.listing_id) {
    try { await maybeAlert(user, { ...rec, dwell_seconds: cumulative }); } catch (_) {}
  }
  return json(200, { ok: true });
};

async function maybeAlert(user, rec) {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const dRes = await rest('engagement_alerts?select=id&user_id=eq.' + user.id +
    '&listing_id=eq.' + encodeURIComponent(rec.listing_id) + '&created_at=gte.' + since + '&limit=1');
  if ((dRes.ok ? await dRes.json() : []).length) return;             // already alerted in 24h
  await rest('engagement_alerts', { method: 'POST', body: JSON.stringify({ user_id: user.id, listing_id: rec.listing_id }) });

  const pRes = await rest('profiles?id=eq.' + user.id + '&select=full_name,phone');
  const [prof] = pRes.ok ? await pRes.json() : [];
  const lead = {
    name: (prof && prof.full_name) || user.email || 'A registered client',
    email: user.email || '',
    phone: (prof && prof.phone) || ''
  };

  const acRes = await rest('agent_clients?client_user_id=eq.' + user.id + '&select=agent_user_id&limit=1');
  const [ac] = acRes.ok ? await acRes.json() : [];
  let recipient = null;
  if (ac && ac.agent_user_id) {
    const aRes = await rest('agents?user_id=eq.' + ac.agent_user_id + '&select=name,email,phone,user_id,ghl_user_id');
    const [ag] = aRes.ok ? await aRes.json() : [];
    if (ag) recipient = { name: ag.name, email: ag.email, phone: ag.phone, user_id: ag.user_id, ghl_user_id: ag.ghl_user_id };
  }
  if (!recipient) recipient = ADMIN_FALLBACK;

  const mins = Math.floor(rec.dwell_seconds / 60);
  const propLabel = rec.title || ('listing ' + rec.listing_id);
  const propUrl = rec.url || (SITE + '/available.html?listing_id=' + encodeURIComponent(rec.listing_id));

  await Promise.allSettled([
    pushAgent(recipient, lead, propLabel, propUrl),
    emailAgent(recipient, lead, propLabel, propUrl, mins),
    ghlAgent(recipient, lead, propLabel, propUrl)
  ]);
}

async function pushAgent(recipient, lead, propLabel, propUrl) {
  if (!recipient.user_id || !process.env.VAPID_PRIVATE_KEY) return;
  try {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    const sRes = await rest('push_subscriptions?user_id=eq.' + recipient.user_id + '&select=subscription');
    const subs = sRes.ok ? await sRes.json() : [];
    const payload = JSON.stringify({
      title: '🔥 Hot lead: ' + lead.name,
      body: lead.name + ' is spending time on ' + propLabel + ' — reach out now.',
      url: propUrl, tag: 'engage-' + (recipient.user_id || 'x')
    });
    await Promise.allSettled(subs.map(s => s.subscription && webpush.sendNotification(s.subscription, payload)));
  } catch (_) {}
}

async function emailAgent(recipient, lead, propLabel, propUrl, mins) {
  if (!RESEND_API_KEY || !recipient.email) return;
  const contact = [
    lead.email ? `<a href="mailto:${esc(lead.email)}">${esc(lead.email)}</a>` : '',
    lead.phone ? `<a href="tel:${esc(lead.phone)}">${esc(lead.phone)}</a>` : ''
  ].filter(Boolean).join(' &middot; ');
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#0e0e0e">
    <div style="font-weight:800;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#8C8A85">🔥 Hot lead alert</div>
    <h2 style="font-size:22px;margin:6px 0">${esc(lead.name)}</h2>
    <p style="color:#555">has been viewing <strong>${esc(propLabel)}</strong> for ${mins}+ minute${mins === 1 ? '' : 's'}.</p>
    ${contact ? `<p><span style="color:#888">Reach them:</span> ${contact}</p>` : ''}
    <p><a href="${esc(propUrl)}" style="display:inline-block;background:#161616;color:#fff;text-decoration:none;font-weight:700;font-size:13px;padding:12px 22px;border-radius:0">View the property</a></p>
  </div>`;
  await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_EMAIL, to: [recipient.email], subject: '🔥 ' + lead.name + ' is viewing ' + propLabel, html })
  }).catch(() => {});
}

async function ghlAgent(recipient, lead, propLabel, propUrl) {
  if (!GHL_WEBHOOK) return;
  await fetch(GHL_WEBHOOK, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'hot_lead',
      email: lead.email || '', phone: lead.phone || '', full_name: lead.name || '',
      lead_name: lead.name || '', lead_email: lead.email || '', lead_phone: lead.phone || '',
      property: propLabel, property_url: propUrl,
      agent_name: recipient.name || '', agent_email: recipient.email || '', agent_phone: recipient.phone || '',
      assigned_ghl_user_id: recipient.ghl_user_id || '',
      message: lead.name + ' is viewing ' + propLabel + ' — reach out. ' + propUrl
    })
  }).catch(() => {});
}
