// ============================================================================
// package-view.js — public, read-only lender package behind a share token.
// Validates the token with the service role (bypasses RLS), computes the model
// SERVER-SIDE, and returns ONLY the numbers a lender should underwrite on.
// Deliberately withheld (never leaves the server): profit / margins,
// cash-on-cash, break-even, and the borrower's target interest rate, points and
// fees — so a share link can't undercut negotiating position. No login.
// ============================================================================
const LoanCalc = require('../../loan-calc.js');

const SB = process.env.SUPABASE_URL;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;

function json(code, obj) {
  return { statusCode: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) };
}

// underwriting checks a lender may see (profit/margin check is intentionally excluded)
const LENDER_CHECKS = { ltc: 1, ltarv: 1, contingency: 1, costSf: 1, equity: 1, dumpster: 1, lineShare: 1, draws: 1 };

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
    const project = projects[0];

    const br = await fetch(SB + '/rest/v1/project_budget_lines?project_id=eq.' + link.project_id + '&select=division,line_item,amount,draw_number,sort_order&order=sort_order', { headers: h });
    const lines = br.ok ? await br.json() : [];

    // compute the full model here; only expose the lender-safe subset below
    const o = LoanCalc.compute(project, lines);

    const view = {
      property: {
        name: project.name || '', address: project.address || '', scope: project.scope || '',
        square_footage: project.square_footage || 0, beds_baths: project.beds_baths || '',
        term_months: project.term_months || null
      },
      purchase_price: Number(project.purchase_price) || 0,
      arv: o.ARV, arvPerSf: o.arvPerSf,
      totalCost: o.totalCost,
      loan: { total: o.totalLoan, acq: o.acqAdvance, holdback: o.holdback },
      equity: o.equity, equityPct: o.equityPct,
      ltc: o.LTC, ltarv: o.LTARV,
      budget: {
        divisions: o.divisions, hardCost: o.hardCost, contingency: o.contingency,
        contRate: o.contRate, totalBudget: o.totalBudget, costPerSf: o.costPerSf
      },
      draws: o.draws.map(function (d) { return { n: d.n, amount: d.amount, cumulative: d.cumulative, cumPct: d.cumPct }; }),
      checks: o.rules.filter(function (r) { return LENDER_CHECKS[r.key]; })
        .map(function (r) { return { key: r.key, label: r.label, value: r.value, pass: r.pass }; })
    };

    // bump view count (fire-and-forget)
    fetch(SB + '/rest/v1/loan_share_links?id=eq.' + link.id, {
      method: 'PATCH',
      headers: Object.assign({}, h, { 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: JSON.stringify({ view_count: (link.view_count || 0) + 1, last_viewed_at: new Date().toISOString() })
    }).catch(function () {});

    return json(200, { view: view });
  } catch (e) {
    return json(500, { error: String((e && e.message) || e) });
  }
};
