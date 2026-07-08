/* netlify/functions/admin-users.js
   Admin-only user management: invite a new admin, or reset an admin's password.
   The CALLER must be a signed-in admin — we verify their Supabase JWT and role
   server-side before doing anything with the service role.

   Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY */

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANON = process.env.SUPABASE_ANON_KEY || '';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json', ...cors }, body: JSON.stringify(obj) });

function tempPassword() {
  const b = require('crypto').randomBytes(6).toString('hex');
  return 'Aterra-' + b + '-2026';
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });
  if (!SUPABASE_URL || !SR || !ANON) return json(500, { ok: false, error: 'not-configured' });

  // 1) verify the caller is a signed-in admin
  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return json(401, { ok: false, error: 'unauthorized' });
  let caller;
  try {
    const uRes = await fetch(SUPABASE_URL + '/auth/v1/user', { headers: { apikey: ANON, Authorization: 'Bearer ' + token } });
    if (!uRes.ok) return json(401, { ok: false, error: 'unauthorized' });
    caller = await uRes.json();
  } catch (_) { return json(401, { ok: false, error: 'unauthorized' }); }
  if (!caller || !caller.id) return json(401, { ok: false, error: 'unauthorized' });

  // confirm admin role (service role read)
  try {
    const pRes = await fetch(SUPABASE_URL + '/rest/v1/profiles?id=eq.' + caller.id + '&select=role', { headers: svc() });
    const [prof] = pRes.ok ? await pRes.json() : [];
    if (!prof || prof.role !== 'admin') return json(403, { ok: false, error: 'forbidden' });
  } catch (_) { return json(403, { ok: false, error: 'forbidden' }); }

  let b; try { b = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { ok: false, error: 'bad-json' }); }
  const action = b.action;

  // 2) invite a new admin
  if (action === 'invite') {
    const email = (b.email || '').trim().toLowerCase();
    const name = (b.name || '').trim();
    if (!email) return json(400, { ok: false, error: 'email-required' });
    const pw = tempPassword();
    const cRes = await fetch(SUPABASE_URL + '/auth/v1/admin/users', {
      method: 'POST', headers: svc(),
      body: JSON.stringify({ email, password: pw, email_confirm: true, user_metadata: { full_name: name || email } })
    });
    const cJson = await cRes.json().catch(() => ({}));
    if (!cRes.ok) return json(400, { ok: false, error: (cJson && (cJson.msg || cJson.error_description || cJson.error)) || 'could-not-create' });
    const uid = cJson.id;
    // ensure profile + admin role
    await fetch(SUPABASE_URL + '/rest/v1/profiles?id=eq.' + uid, {
      method: 'PATCH', headers: { ...svc(), Prefer: 'return=minimal' },
      body: JSON.stringify({ role: 'admin', full_name: name || email })
    }).catch(() => {});
    return json(200, { ok: true, email, temp_password: pw });
  }

  // 3) reset a user's password (by user id or email)
  if (action === 'reset') {
    let uid = b.user_id;
    const email = (b.email || '').trim().toLowerCase();
    if (!uid && email) {
      const lRes = await fetch(SUPABASE_URL + '/auth/v1/admin/users?email=' + encodeURIComponent(email), { headers: svc() });
      const lj = lRes.ok ? await lRes.json() : {};
      uid = lj && lj.users && lj.users[0] && lj.users[0].id;
    }
    if (!uid) return json(400, { ok: false, error: 'user-not-found' });
    const pw = tempPassword();
    const rRes = await fetch(SUPABASE_URL + '/auth/v1/admin/users/' + uid, {
      method: 'PUT', headers: svc(), body: JSON.stringify({ password: pw })
    });
    if (!rRes.ok) return json(400, { ok: false, error: 'could-not-reset' });
    return json(200, { ok: true, temp_password: pw });
  }

  return json(400, { ok: false, error: 'unknown-action' });
};

function svc() { return { apikey: SR, Authorization: 'Bearer ' + SR, 'Content-Type': 'application/json' }; }
