// ============================================================================
// loan-import.js — create a new project from an uploaded loan/budget workbook.
// Parses the .xlsx deterministically (works with the Aterra package format and
// reasonable builder budgets); if that finds little and ANTHROPIC_API_KEY is
// configured, falls back to an AI extraction pass. Writes the project + budget
// lines to Supabase using the CALLER's bearer token (RLS enforces admin-only).
// ============================================================================
const ExcelJS = require('exceljs');

const SB = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const AI_KEY = process.env.ANTHROPIC_API_KEY;
const AI_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

function json(code, obj) { return { statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) }; }

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
    if (!SB || !ANON) return json(500, { error: 'Supabase env not configured' });
    const auth = event.headers.authorization || event.headers.Authorization;
    if (!auth) return json(401, { error: 'Missing authorization' });
    const body = JSON.parse(event.body || '{}');
    if (!body.data) return json(400, { error: 'No file data' });

    const buf = Buffer.from(body.data, 'base64');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);

    let parsed = parseWorkbook(wb);
    let source = 'structured';
    if (parsed.lines.length < 3 && AI_KEY) {
      const ai = await aiExtract(sheetsToText(wb));
      if (ai && Array.isArray(ai.budget_lines) && ai.budget_lines.length >= parsed.lines.length) {
        parsed = { fields: Object.assign({}, parsed.fields, cleanFields(ai)), lines: ai.budget_lines.map(normalizeLine).filter(Boolean) };
        source = 'ai';
      }
    }
    if (!parsed.lines.length && !Object.keys(parsed.fields).length) {
      return json(422, { error: 'Could not read a budget from this file.' + (AI_KEY ? '' : ' (AI extraction is off — set ANTHROPIC_API_KEY to enable it.)') });
    }

    const name = parsed.fields.name || (body.filename || 'Imported project').replace(/\.[a-z]+$/i, '');
    const project = buildProjectPayload(name, parsed);

    const h = { apikey: ANON, Authorization: auth, 'Content-Type': 'application/json', Prefer: 'return=representation' };
    const pRes = await fetch(SB + '/rest/v1/projects', { method: 'POST', headers: h, body: JSON.stringify(project) });
    if (!pRes.ok) { const t = await pRes.text(); return json(pRes.status, { error: 'Create failed: ' + t.slice(0, 200) }); }
    const created = (await pRes.json())[0];
    if (!created || !created.id) return json(500, { error: 'Create returned no id' });

    if (parsed.lines.length) {
      const payload = parsed.lines.slice(0, 200).map(function (l, i) {
        return { project_id: created.id, division: l.division || null, line_item: l.line_item || null,
                 amount: l.amount || 0, draw_number: l.draw_number || null, sort_order: i };
      });
      await fetch(SB + '/rest/v1/project_budget_lines', { method: 'POST', headers: { apikey: ANON, Authorization: auth, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(payload) });
    }

    return json(200, { project_id: created.id, name: created.name, count: parsed.lines.length, source: source, fields: Object.keys(parsed.fields) });
  } catch (e) {
    return json(500, { error: String((e && e.message) || e) });
  }
};

// ---------------------------------------------------------------------------
function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map(function (t) { return t.text; }).join('');
    if ('result' in v) return cellText(v.result);
    if ('text' in v) return String(v.text);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return '';
  }
  return String(v);
}
function cellNum(v) {
  if (v && typeof v === 'object' && 'result' in v) return cellNum(v.result);
  const n = parseFloat(String(cellText(v)).replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? n : null;
}

// field label rules (first match wins)
const RULES = [
  { re: /completed square footage|square footage|^\s*sf\b|sq\.?\s*ft/i, f: 'square_footage', k: 'num' },
  { re: /arv per|arv\s*\/\s*sf|per square foot/i, f: 'arv_per_sf', k: 'num' },
  { re: /after repair value|^\s*arv\b|estimated .*value/i, f: 'arv_total', k: 'num' },
  { re: /purchase price|as-?is value|land ?\/? ?lot|acquisition cost/i, f: 'purchase_price', k: 'money' },
  { re: /closing costs|title.*survey/i, f: 'closing_costs', k: 'money' },
  { re: /interest rate/i, f: 'interest_rate', k: 'pct' },
  { re: /construction term|term \(months\)|loan term/i, f: 'term_months', k: 'num' },
  { re: /contingency/i, f: 'contingency_rate', k: 'pct' },
  { re: /lender points|points \(/i, f: 'points_pct', k: 'pct' },
  { re: /selling cost|cost of sale/i, f: 'selling_cost_pct', k: 'pct' },
  { re: /subject property|property address|^\s*address/i, f: 'address', k: 'text' },
  { re: /borrower ?\/? ?builder|borrower name|^\s*builder\b/i, f: 'borrower', k: 'text' },
  { re: /scope of work|project scope/i, f: 'scope', k: 'text' },
  { re: /bedrooms ?\/? ?bath|beds ?\/? ?bath/i, f: 'beds_baths', k: 'text' }
];

function parseWorkbook(wb) {
  const fields = {};
  // 1) scan every sheet for labelled fields
  wb.eachSheet(function (ws) {
    const rows = ws.getSheetValues();
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r]; if (!row) continue;
      for (let c = 1; c < row.length; c++) {
        const label = cellText(row[c]).trim();
        if (!label || label.length > 60) continue;
        for (let ri = 0; ri < RULES.length; ri++) {
          const rule = RULES[ri];
          if (fields[rule.f] !== undefined) continue;
          if (!rule.re.test(label)) continue;
          // value = next non-empty cell to the right, else the cell below
          let val = null;
          for (let cc = c + 1; cc < row.length; cc++) { if (row[cc] != null && cellText(row[cc]) !== '') { val = row[cc]; break; } }
          if (val == null && rows[r + 1]) val = rows[r + 1][c];
          if (val == null) continue;
          if (rule.k === 'text') { const t = cellText(val).trim(); if (t) fields[rule.f] = t; }
          else {
            let n = cellNum(val); if (n == null) continue;
            if (rule.k === 'pct') { if (n > 1) n = n / 100; if (n > 1 || n < 0) continue; }
            if (rule.k === 'num' && n <= 0) continue;
            fields[rule.f] = n;
          }
        }
      }
    }
  });
  // 2) budget lines from the best candidate sheet
  const lines = extractBudget(wb);
  // derive arv_per_sf if only a total ARV was found
  if (fields.arv_per_sf == null && fields.arv_total && fields.square_footage) fields.arv_per_sf = fields.arv_total / fields.square_footage;
  delete fields.arv_total;
  return { fields: fields, lines: lines };
}

function extractBudget(wb) {
  let best = null, bestScore = -1;
  wb.eachSheet(function (ws) {
    const rows = ws.getSheetValues();
    let score = 0;
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r]; if (!row) continue;
      let hasText = false, hasBig = false;
      for (let c = 1; c < row.length; c++) {
        const t = cellText(row[c]);
        if (t && isNaN(parseFloat(t))) hasText = true;
        const n = cellNum(row[c]); if (n != null && n >= 100) hasBig = true;
      }
      if (hasText && hasBig) score++;
    }
    if (/budget/i.test(ws.name)) score += 20;
    if (score > bestScore) { bestScore = score; best = ws; }
  });
  if (!best) return [];
  const rows = best.getSheetValues();
  const lines = [];
  let division = '';
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]; if (!row) continue;
    // first text cell = label, first positive number after it = amount
    let label = '', labelCol = -1, amount = null, draw = null;
    for (let c = 1; c < row.length; c++) {
      const t = cellText(row[c]).trim();
      if (label === '' && t && /[a-zA-Z]/.test(t)) { label = t; labelCol = c; continue; }
      if (labelCol > -1 && c > labelCol) {
        const n = cellNum(row[c]);
        if (n != null) {
          if (amount == null && n >= 100) amount = n;
          else if (draw == null && n >= 1 && n <= 6 && Number.isInteger(n)) draw = n;
        }
      }
    }
    if (!label) continue;
    // skip title/subtitle/legend prose (bullets or long sentences)
    if (/[•·]/.test(label) || label.length > 80) continue;
    // division header (e.g. "10 — SOFT COSTS...") — no amount
    if (amount == null && /^\s*\d{1,2}\s*[—\-–:.)]/.test(label)) { division = label.replace(/\s+/g, ' ').trim(); continue; }
    if (amount == null) continue;
    if (/subtotal|^total|hard construction|construction budget|cost per|per sf|% of|contingency/i.test(label)) continue;
    lines.push({ division: division, line_item: label.replace(/^\s+/, ''), amount: amount, draw_number: draw });
  }
  return lines;
}

function buildProjectPayload(name, parsed) {
  const f = parsed.fields;
  const p = {
    name: name, status: 'draft',
    address: f.address || null, borrower: f.borrower || null, scope: f.scope || null,
    beds_baths: f.beds_baths || null,
    square_footage: f.square_footage || null,
    term_months: f.term_months || 8,
    purchase_price: f.purchase_price || 0,
    closing_costs: f.closing_costs || 0,
    arv_per_sf: f.arv_per_sf || 0,
    interest_rate: f.interest_rate || 0.095,
    points_pct: f.points_pct || 0.015,
    admin_fee: 5000,
    contingency_rate: f.contingency_rate || 0.05,
    selling_cost_pct: f.selling_cost_pct || 0.03,
    escrow_interest: false,
    notes: 'Imported from an uploaded workbook — review the highlighted inputs.'
  };
  return p;
}

// ---- AI fallback -----------------------------------------------------------
function sheetsToText(wb) {
  let out = [];
  wb.eachSheet(function (ws) {
    out.push('# Sheet: ' + ws.name);
    const rows = ws.getSheetValues();
    for (let r = 1; r < rows.length && r < 60; r++) {
      const row = rows[r]; if (!row) continue;
      const cells = [];
      for (let c = 1; c < row.length && c < 10; c++) { const t = cellText(row[c]); if (t) cells.push(t); }
      if (cells.length) out.push(cells.join(' | '));
    }
  });
  return out.join('\n').slice(0, 24000);
}
function normalizeLine(l) {
  if (!l) return null;
  const amt = parseFloat(l.amount); if (!isFinite(amt) || amt <= 0) return null;
  const d = parseInt(l.draw_number, 10);
  return { division: l.division || '', line_item: l.line_item || '', amount: amt, draw_number: (d >= 1 && d <= 6) ? d : null };
}
function cleanFields(ai) {
  const f = {};
  ['square_footage', 'purchase_price', 'arv_per_sf', 'interest_rate', 'term_months', 'contingency_rate', 'points_pct', 'closing_costs', 'selling_cost_pct'].forEach(function (k) {
    let v = parseFloat(ai[k]); if (isFinite(v)) { if (/rate|pct|contingency/.test(k) && v > 1) v = v / 100; f[k] = v; }
  });
  ['name', 'address', 'borrower', 'scope', 'beds_baths'].forEach(function (k) { if (ai[k]) f[k] = String(ai[k]); });
  return f;
}
async function aiExtract(text) {
  try {
    const prompt = 'Extract a construction-loan project from this spreadsheet text. Return ONLY JSON with keys: ' +
      'name, address, borrower, scope, beds_baths, square_footage, purchase_price, arv_per_sf, interest_rate (as a decimal like 0.095), ' +
      'term_months, contingency_rate (decimal), points_pct (decimal), closing_costs, selling_cost_pct (decimal), and ' +
      'budget_lines: an array of {division, line_item, amount, draw_number}. Omit unknown fields. Spreadsheet:\n\n' + text;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': AI_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: AI_MODEL, max_tokens: 4000, messages: [{ role: 'user', content: prompt }] })
    });
    if (!res.ok) return null;
    const data = await res.json();
    const txt = (data.content && data.content[0] && data.content[0].text) || '';
    const m = txt.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch (e) { return null; }
}

exports.parseWorkbook = parseWorkbook;
