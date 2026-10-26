/* netlify/functions/contacts-api.js
   Secured machine-to-machine API so Voss can add people to the admin Contacts
   rolodex (public.contacts) — e.g. from a business card JoJo texts him.
   Same shared secret as invest-api.js (Netlify env INVEST_API_TOKEN), sent as:
       Authorization: Bearer <INVEST_API_TOKEN>
       x-invest-token: <INVEST_API_TOKEN>

   Route (via netlify.toml rewrite):
     POST /api/contacts-add  { contact_name | company*, category?, title?, email?, phone?,
                               website?, instagram?, address?, trade?, market?, status?, notes? }
                             -> { ok, id, updated }

   A person already in the rolodex (same email, else same phone) is filled in
   rather than added twice: empty fields get the new values and the new notes
   are added under the old ones.

   Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INVEST_API_TOKEN */

const crypto = require('crypto');
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const API_TOKEN = process.env.INVEST_API_TOKEN || '';

const CATEGORIES = ['lender', 'contractor', 'vendor', 'other'];
const STATUSES = ['Active', 'Preferred', 'Prospect', 'Do Not Use'];
const TEXT_FIELDS = ['company', 'contact_name', 'title', 'email', 'phone', 'website', 'instagram', 'address', 'trade', 'market'];

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

// The body Voss sends → a contacts row. Unknown categories land in 'other' so a
// card is never dropped for a label the rolodex doesn't have.
function toRow(body) {
  const row = {};
  for (const f of TEXT_FIELDS) {
    const v = (body[f] == null ? '' : String(body[f])).trim();
    if (v) row[f] = v;
  }
  if (!row.contact_name && body.name) row.contact_name = String(body.name).trim();
  const cat = String(body.category || '').trim().toLowerCase();
  row.category = CATEGORIES.indexOf(cat) === -1 ? 'other' : cat;
  const status = STATUSES.find(s => s.toLowerCase() === String(body.status || '').trim().toLowerCase());
  if (status) row.status = status;
  const notes = String(body.notes || '').trim();
  if (notes) row.notes = notes;
  return row;
}

// What to PATCH onto an existing row: only fields it is missing, plus notes appended.
function mergeInto(existing, row) {
  const patch = {};
  for (const f of TEXT_FIELDS) if (row[f] && !existing[f]) patch[f] = row[f];
  if (row.notes && !(existing.notes || '').includes(row.notes)) {
    patch.notes = existing.notes ? existing.notes + '\n\n' + row.notes : row.notes;
  }
  return patch;
}

async function findExisting(row) {
  const tries = [];
  if (row.email) tries.push('email=ilike.' + encodeURIComponent(row.email));
  if (row.phone) tries.push('phone=eq.' + encodeURIComponent(row.phone));
  for (const q of tries) {
    const r = await rest('contacts?select=*&limit=1&' + q);
    const rows = r.ok ? await r.json() : [];
    if (rows.length) return rows[0];
  }
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, body: '' };
  if (!SUPABASE_URL || !SR) return json(500, { ok: false, error: 'not-configured' });
  if (!API_TOKEN) return json(500, { ok: false, error: 'api-token-not-set' });
  if (!authed(event)) return json(401, { ok: false, error: 'unauthorized' });
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'method' });

  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch (_) {}
  const row = toRow(body);
  if (!row.contact_name && !row.company) return json(400, { ok: false, error: 'name-or-company-required' });

  const existing = await findExisting(row);
  if (existing) {
    const patch = mergeInto(existing, row);
    if (Object.keys(patch).length) {
      const r = await rest('contacts?id=eq.' + existing.id, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
      if (!r.ok) return json(500, { ok: false, error: 'update-failed', detail: await r.text().catch(() => '') });
    }
    return json(200, { ok: true, id: existing.id, updated: true });
  }

  const r = await rest('contacts', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) });
  if (!r.ok) return json(500, { ok: false, error: 'create-failed', detail: await r.text().catch(() => '') });
  const created = (await r.json())[0] || {};
  return json(200, { ok: true, id: created.id, updated: false });
};

exports.toRow = toRow;
exports.mergeInto = mergeInto;
