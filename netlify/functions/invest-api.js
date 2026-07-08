/* netlify/functions/invest-api.js
   Secured machine-to-machine API for minting / managing investor access links.
   Gated by a shared secret (Netlify env INVEST_API_TOKEN), sent as either:
       Authorization: Bearer <INVEST_API_TOKEN>
       x-invest-token: <INVEST_API_TOKEN>

   Routes (via netlify.toml rewrites):
     POST /api/invest-create   { investor_name*, email?, phone?, deck?, label? } -> { ok, url, token }
     POST /api/invest-revoke   { token* }                                        -> { ok, revoked }
     GET  /api/invest-list      [?deck=&active=]                                  -> { ok, links: [...] }

   Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INVEST_API_TOKEN, ATERRA_SITE_URL(optional) */

const crypto = require('crypto');
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const API_TOKEN = process.env.INVEST_API_TOKEN || '';
const SITE = (process.env.ATERRA_SITE_URL || 'https://aterrabuilders.com').replace(/\/$/, '');
const DECKS = ['investor', 'partner']; // recognised deck variants

const json = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
const svc = { apikey: SR, Authorization: 'Bearer ' + SR, 'Content-Type': 'application/json' };
const rest = (path, opts = {}) => fetch(SUPABASE_URL + '/rest/v1/' + path, { ...opts, headers: { ...svc, ...(opts.headers || {}) } });

function authed(event) {
  if (!API_TOKEN) return false;
  const h = event.headers || {};
  const bearer = (h.authorization || h.Authorization || '').replace(/^Bearer\s+/i, '').trim();
  const custom = (h['x-invest-token'] || h['X-Invest-Token'] || '').trim();
  const provided = bearer || custom;
  if (!provided) return false;
  const a = Buffer.from(provided), b = Buffer.from(API_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, body: '' };
  if (!SUPABASE_URL || !SR) return json(500, { ok: false, error: 'not-configured' });
  if (!API_TOKEN) return json(500, { ok: false, error: 'api-token-not-set' });
  if (!authed(event)) return json(401, { ok: false, error: 'unauthorized' });

  const action = (event.queryStringParameters && event.queryStringParameters.action) || '';
  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch (_) {}

  // ---- create ----
  if (action === 'create') {
    if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'method' });
    const investor_name = (body.investor_name || '').toString().trim();
    if (!investor_name) return json(400, { ok: false, error: 'investor_name-required' });
    let deck = (body.deck || 'investor').toString().trim().toLowerCase();
    if (DECKS.indexOf(deck) === -1) deck = 'investor';
    const token = crypto.randomBytes(16).toString('hex');
    const row = {
      token: token,
      name: investor_name,
      email: (body.email || '').toString().trim() || null,
      phone: (body.phone || '').toString().trim() || null,
      note: (body.label || '').toString().trim() || null,
      deck: deck
    };
    const r = await rest('investor_links', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(row) });
    if (!r.ok) return json(500, { ok: false, error: 'create-failed', detail: await r.text().catch(() => '') });
    return json(200, { ok: true, url: SITE + '/invest?key=' + token, token: token, deck: deck });
  }

  // ---- revoke ----
  if (action === 'revoke') {
    if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'method' });
    const token = (body.token || '').toString().trim();
    if (!token) return json(400, { ok: false, error: 'token-required' });
    const r = await rest('investor_links?token=eq.' + encodeURIComponent(token), {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ active: false })
    });
    const rows = r.ok ? await r.json() : [];
    return json(200, { ok: true, revoked: rows.length });
  }

  // ---- list / stats ----
  if (action === 'list') {
    var q = 'investor_links?select=token,name,email,phone,deck,active,view_count,last_viewed_at,created_at&order=created_at.desc&limit=1000';
    const p = event.queryStringParameters || {};
    if (p.deck) q += '&deck=eq.' + encodeURIComponent(p.deck);
    if (p.active === 'true' || p.active === 'false') q += '&active=eq.' + p.active;
    const r = await rest(q);
    const links = r.ok ? await r.json() : [];
    const withUrl = links.map(function (l) { return { ...l, url: SITE + '/invest?key=' + l.token }; });
    const total_views = withUrl.reduce(function (s, l) { return s + (l.view_count || 0); }, 0);
    return json(200, { ok: true, count: withUrl.length, total_views: total_views, links: withUrl });
  }

  return json(400, { ok: false, error: 'unknown-action' });
};
