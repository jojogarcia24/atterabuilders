// ============================================================================
// package-view.js — public, read-only lender package behind a share token.
// Validates the token with the service role (bypasses RLS), returns only the
// lender-appropriate project fields + budget lines, and bumps the view count.
// No login required; investor economics / internal docs are stripped out.
// ============================================================================
const SB = process.env.SUPABASE_URL;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;

function json(code, obj) {
  return { statusCode: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) };
}

// fields safe to expose to a lender (NOT capital, reo, documents, notes, created_by)
const SAFE = ['name', 'status', 'address', 'borrower', 'scope', 'square_footage', 'stories',
  'beds_baths', 'lot_size', 'term_months', 'start_date', 'completion_date', 'purchase_price',
  'closing_costs', 'arv_per_sf', 'interest_rate', 'points_pct', 'admin_fee', 'contingency_rate',
  'selling_cost_pct', 'escrow_interest', 'rules'];

exports.handler = async function (event) {
  try {
    if (!SB || !SRK) return json(500, { error: 'Server not configured' });
    const token = (event.queryStringParameters && event.queryStringParameters.key) ||
      (event.body ? (JSON.parse(event.body).key || '') : '');
    if (!token) return json(400, { error: 'Missing key' });

    const h = { apikey: SRK, Authorization: 'Bearer ' + SRK };
    const lr = await fetch(SB + '/rest/v1/loan_share_links?token=eq.' + encodeURIComponent(token) + '&select=*', { headers: h });
    const links = lr.ok ? await lr.json() : [];
    if (!links.length || !links[0].active) return json(404, { error: 'This link is not active.' });
    const link = links[0];

    const pr = await fetch(SB + '/rest/v1/projects?id=eq.' + link.project_id + '&select=*', { headers: h });
    const projects = pr.ok ? await pr.json() : [];
    if (!projects.length) return json(404, { error: 'Package not found.' });
    const full = projects[0];
    const project = {};
    SAFE.forEach(function (k) { if (full[k] !== undefined) project[k] = full[k]; });

    const br = await fetch(SB + '/rest/v1/project_budget_lines?project_id=eq.' + link.project_id + '&select=division,line_item,amount,draw_number,sort_order&order=sort_order', { headers: h });
    const lines = br.ok ? await br.json() : [];

    // bump view count (fire-and-forget)
    fetch(SB + '/rest/v1/loan_share_links?id=eq.' + link.id, {
      method: 'PATCH',
      headers: Object.assign({}, h, { 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: JSON.stringify({ view_count: (link.view_count || 0) + 1, last_viewed_at: new Date().toISOString() })
    }).catch(function () {});

    return json(200, { project: project, lines: lines });
  } catch (e) {
    return json(500, { error: String((e && e.message) || e) });
  }
};
