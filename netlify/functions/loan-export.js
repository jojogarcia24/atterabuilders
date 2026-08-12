// ============================================================================
// loan-export.js — generate a formatted .xlsx construction-loan package from a
// project. Reads the project + budget lines from Supabase using the CALLER's
// bearer token (so row-level security enforces admin-only access), runs the
// shared LoanCalc engine, and returns a multi-tab workbook.
// ============================================================================
const ExcelJS = require('exceljs');
const LoanCalc = require('../../loan-calc.js');

const SB = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;

const FONT = 'Arial';
const MONEY = '$#,##0';
const MONEY2 = '$#,##0.00';
const PCT = '0.0%';

function json(code, obj) {
  return { statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
    if (!SB || !ANON) return json(500, { error: 'Supabase env not configured' });
    const auth = event.headers.authorization || event.headers.Authorization;
    if (!auth) return json(401, { error: 'Missing authorization' });
    const body = JSON.parse(event.body || '{}');
    const id = body.project_id;
    if (!id) return json(400, { error: 'project_id required' });

    const h = { apikey: ANON, Authorization: auth };
    const pRes = await fetch(SB + '/rest/v1/projects?id=eq.' + encodeURIComponent(id) + '&select=*', { headers: h });
    if (!pRes.ok) return json(pRes.status, { error: 'Supabase read failed' });
    const projects = await pRes.json();
    if (!Array.isArray(projects) || !projects.length) return json(403, { error: 'Project not found or not permitted' });
    const project = projects[0];

    const lRes = await fetch(SB + '/rest/v1/project_budget_lines?project_id=eq.' + encodeURIComponent(id) + '&select=*&order=sort_order', { headers: h });
    const lines = lRes.ok ? await lRes.json() : [];

    const o = LoanCalc.compute(project, lines);
    const cap = LoanCalc.capital(o, project.capital || {});
    const wb = buildWorkbook(project, lines, o, cap);

    const buf = await wb.xlsx.writeBuffer();
    const fname = String(project.name || 'loan-package').replace(/[^a-z0-9\-_. ]/gi, '').trim().slice(0, 60) || 'loan-package';
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="' + fname + '.xlsx"'
      },
      isBase64Encoded: true,
      body: Buffer.from(buf).toString('base64')
    };
  } catch (e) {
    return json(500, { error: String((e && e.message) || e) });
  }
};

// exported for local tests; Netlify only invokes `handler`.
exports.buildWorkbook = buildWorkbook;

// ---------------------------------------------------------------------------
function buildWorkbook(p, lines, o, cap) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Aterra Builders';
  sheetLender(wb, p, o);
  sheetBudget(wb, p, lines, o);
  sheetDraws(wb, o);
  sheetCapital(wb, p, o, cap);
  sheetChecks(wb, o);
  return wb;
}

function title(ws, docLabel, p) {
  ws.mergeCells('A1:D1');
  const t = ws.getCell('A1');
  t.value = 'ATERRA BUILDERS';
  t.font = { name: FONT, size: 16, bold: true };
  ws.mergeCells('A2:D2');
  const d = ws.getCell('A2');
  d.value = docLabel;
  d.font = { name: FONT, size: 10, color: { argb: 'FF666666' } };
  ws.mergeCells('A3:D3');
  const s = ws.getCell('A3');
  s.value = (p.address || p.name || '') + (p.square_footage ? '  •  ' + Number(p.square_footage).toLocaleString() + ' SF' : '') + (p.beds_baths ? '  •  ' + p.beds_baths : '');
  s.font = { name: FONT, size: 10, color: { argb: 'FF444444' } };
}

function sectionHeader(ws, row, text) {
  ws.mergeCells('A' + row + ':D' + row);
  const c = ws.getCell('A' + row);
  c.value = text;
  c.font = { name: FONT, size: 11, bold: true };
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0EFEA' } };
  ws.getRow(row).height = 18;
}

function kv(ws, row, label, value, fmt, opts) {
  opts = opts || {};
  const a = ws.getCell('A' + row); a.value = label; a.font = { name: FONT, size: 10, bold: !!opts.bold };
  const b = ws.getCell('B' + row); b.value = value;
  b.font = { name: FONT, size: 10, bold: !!opts.bold };
  b.alignment = { horizontal: 'right' };
  if (fmt) b.numFmt = fmt;
  if (opts.top) { a.border = b.border = { top: { style: 'thin', color: { argb: 'FF333333' } } }; }
  return row + 1;
}

function sheetLender(wb, p, o) {
  const ws = wb.addWorksheet('Lender Summary', { views: [{ showGridLines: false }] });
  ws.getColumn(1).width = 42; ws.getColumn(2).width = 20; ws.getColumn(3).width = 4; ws.getColumn(4).width = 18;
  title(ws, 'Construction Loan Request', p);
  let r = 5;
  sectionHeader(ws, r, 'LOAN REQUEST'); r += 1;
  r = kv(ws, r, 'Purchase / as-is value', o.totalCost != null ? p.purchase_price : 0, MONEY);
  r = kv(ws, r, 'Acquisition advance', o.acqAdvance, MONEY);
  r = kv(ws, r, 'Construction holdback', o.holdback, MONEY);
  r = kv(ws, r, 'Total loan requested', o.totalLoan, MONEY, { bold: true, top: true });
  r = kv(ws, r, 'Borrower equity', o.equity, MONEY);
  r = kv(ws, r, 'Borrower equity % of cost', o.equityPct, PCT);
  r += 1;
  sectionHeader(ws, r, 'KEY METRICS'); r += 1;
  r = kv(ws, r, 'Total project cost', o.totalCost, MONEY);
  r = kv(ws, r, 'Loan-to-Cost (LTC)', o.LTC, PCT);
  r = kv(ws, r, 'Loan-to-ARV (LTARV)', o.LTARV, PCT);
  r = kv(ws, r, 'Estimated ARV', o.ARV, MONEY);
  r = kv(ws, r, 'ARV per SF', o.arvPerSf, MONEY);
  r = kv(ws, r, 'Gross profit', o.grossProfit, MONEY);
  r = kv(ws, r, 'Gross margin on ARV', o.grossMargin, PCT);
  r = kv(ws, r, 'Net profit after sale', o.netProfit, MONEY);
  r = kv(ws, r, 'Net margin on ARV', o.netMargin, PCT);
  r = kv(ws, r, 'Cash-on-cash return', o.cashOnCash, PCT);
  r += 1;
  sectionHeader(ws, r, 'FINANCING'); r += 1;
  r = kv(ws, r, 'Interest reserve (paid monthly)', o.interestReserve, MONEY);
  r = kv(ws, r, 'Lender points & fees', o.pointsFees, MONEY);
  r = kv(ws, r, 'Cash to close', o.cashToClose, MONEY);
  r = kv(ws, r, 'Total cash into the deal', o.totalCashIn, MONEY, { bold: true, top: true });
}

function sheetBudget(wb, p, lines, o) {
  const ws = wb.addWorksheet('Construction Budget', { views: [{ showGridLines: false }] });
  ws.getColumn(1).width = 44; ws.getColumn(2).width = 18; ws.getColumn(3).width = 10; ws.getColumn(4).width = 14;
  title(ws, 'Detailed Construction Budget', p);
  let r = 5;
  const hdr = ws.getRow(r);
  hdr.values = ['Line item', 'Amount', 'Draw #', 'Division'];
  hdr.font = { name: FONT, size: 10, bold: true };
  hdr.eachCell(function (c) { c.border = { bottom: { style: 'thin', color: { argb: 'FF333333' } } }; });
  r += 1;
  const byDiv = {};
  (lines || []).forEach(function (l) { const d = l.division || 'Other'; (byDiv[d] = byDiv[d] || []).push(l); });
  Object.keys(byDiv).sort().forEach(function (d) {
    const dh = ws.getCell('A' + r); dh.value = d; dh.font = { name: FONT, size: 10, bold: true };
    dh.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0EFEA' } };
    r += 1;
    byDiv[d].forEach(function (l) {
      ws.getCell('A' + r).value = l.line_item || '';
      ws.getCell('A' + r).font = { name: FONT, size: 10 };
      const b = ws.getCell('B' + r); b.value = Number(l.amount) || 0; b.numFmt = MONEY; b.font = { name: FONT, size: 10 }; b.alignment = { horizontal: 'right' };
      const c = ws.getCell('C' + r); c.value = l.draw_number || ''; c.font = { name: FONT, size: 10 }; c.alignment = { horizontal: 'center' };
      r += 1;
    });
    const st = ws.getCell('A' + r); st.value = '   Subtotal'; st.font = { name: FONT, size: 10, italic: true };
    const sb = ws.getCell('B' + r); sb.value = o.divisions[d] || 0; sb.numFmt = MONEY; sb.font = { name: FONT, size: 10, italic: true }; sb.alignment = { horizontal: 'right' };
    r += 1;
  });
  r += 1;
  r = kv(ws, r, 'Hard construction costs', o.hardCost, MONEY, { bold: true, top: true });
  r = kv(ws, r, 'Contingency (' + (o.contRate * 100).toFixed(0) + '%)', o.contingency, MONEY);
  r = kv(ws, r, 'TOTAL CONSTRUCTION BUDGET', o.totalBudget, MONEY, { bold: true, top: true });
  r = kv(ws, r, 'Cost per SF', o.costPerSf, MONEY2);
}

function sheetDraws(wb, o) {
  const ws = wb.addWorksheet('Draw Schedule', { views: [{ showGridLines: false }] });
  ws.getColumn(1).width = 12; ws.getColumn(2).width = 18; ws.getColumn(3).width = 16; ws.getColumn(4).width = 14;
  ws.mergeCells('A1:D1'); ws.getCell('A1').value = 'ATERRA BUILDERS'; ws.getCell('A1').font = { name: FONT, size: 16, bold: true };
  ws.mergeCells('A2:D2'); ws.getCell('A2').value = 'Construction Draw Schedule'; ws.getCell('A2').font = { name: FONT, size: 10, color: { argb: 'FF666666' } };
  let r = 4;
  const hdr = ws.getRow(r); hdr.values = ['Draw', 'Amount', 'Cumulative', 'Cum %'];
  hdr.font = { name: FONT, size: 10, bold: true };
  hdr.eachCell(function (c) { c.border = { bottom: { style: 'thin', color: { argb: 'FF333333' } } }; });
  r += 1;
  o.draws.forEach(function (d) {
    ws.getCell('A' + r).value = 'Draw ' + d.n; ws.getCell('A' + r).font = { name: FONT, size: 10 };
    const b = ws.getCell('B' + r); b.value = d.amount; b.numFmt = MONEY; b.font = { name: FONT, size: 10 }; b.alignment = { horizontal: 'right' };
    const c = ws.getCell('C' + r); c.value = d.cumulative; c.numFmt = MONEY; c.font = { name: FONT, size: 10 }; c.alignment = { horizontal: 'right' };
    const e = ws.getCell('D' + r); e.value = d.cumPct; e.numFmt = PCT; e.font = { name: FONT, size: 10 }; e.alignment = { horizontal: 'right' };
    r += 1;
  });
  const tl = ws.getCell('A' + r); tl.value = 'Total'; tl.font = { name: FONT, size: 10, bold: true }; tl.border = { top: { style: 'thin', color: { argb: 'FF333333' } } };
  const tb = ws.getCell('B' + r); tb.value = o.drawTotal; tb.numFmt = MONEY; tb.font = { name: FONT, size: 10, bold: true }; tb.alignment = { horizontal: 'right' }; tb.border = { top: { style: 'thin', color: { argb: 'FF333333' } } };
}

function sheetCapital(wb, p, o, c) {
  const ws = wb.addWorksheet('Capital Partners', { views: [{ showGridLines: false }] });
  ws.getColumn(1).width = 40; ws.getColumn(2).width = 18; ws.getColumn(3).width = 14; ws.getColumn(4).width = 16;
  title(ws, 'Capital Partner Opportunity', p);
  let r = 5;
  sectionHeader(ws, r, 'CAPITAL STACK'); r += 1;
  r = kv(ws, r, 'Senior construction loan (first lien)', c.seniorLoan, MONEY);
  r = kv(ws, r, 'Partner capital raised', c.raised, MONEY);
  r = kv(ws, r, 'Total capitalization', c.seniorLoan + c.raised, MONEY, { bold: true, top: true });
  r += 1;
  sectionHeader(ws, r, 'CASH NEED & RESERVE'); r += 1;
  r = kv(ws, r, 'Cash required (equity + working capital)', c.cashNeed, MONEY);
  r = kv(ws, r, 'Capital raised', c.raised, MONEY);
  r = kv(ws, r, 'Reserve / (shortfall)', c.surplus, MONEY, { bold: true, top: true });
  r += 1;
  sectionHeader(ws, r, 'PROJECTED RETURNS'); r += 1;
  r = kv(ws, r, 'Net profit to partnership', o.netProfit, MONEY);
  r = kv(ws, r, 'Profit per capital partner', c.profitPerCap, MONEY);
  r = kv(ws, r, 'Return on capital', c.roc, PCT);
  r = kv(ws, r, 'Annualized return', c.annual, PCT);
  r += 1;
  sectionHeader(ws, r, 'DOWNSIDE — SALE PRICE SENSITIVITY'); r += 1;
  const hdr = ws.getRow(r); hdr.values = ['Sale $/SF', 'Sale price', 'Net profit', 'Per partner'];
  hdr.font = { name: FONT, size: 10, bold: true };
  hdr.eachCell(function (cell) { cell.border = { bottom: { style: 'thin', color: { argb: 'FF333333' } } }; });
  r += 1;
  c.downside.forEach(function (d) {
    ws.getCell('A' + r).value = Math.round(d.psf); ws.getCell('A' + r).font = { name: FONT, size: 10 };
    const b = ws.getCell('B' + r); b.value = d.sale; b.numFmt = MONEY; b.font = { name: FONT, size: 10 }; b.alignment = { horizontal: 'right' };
    const n = ws.getCell('C' + r); n.value = d.netProfit; n.numFmt = MONEY; n.font = { name: FONT, size: 10 }; n.alignment = { horizontal: 'right' };
    const pc = ws.getCell('D' + r); pc.value = d.perCapital; pc.numFmt = MONEY; pc.font = { name: FONT, size: 10 }; pc.alignment = { horizontal: 'right' };
    r += 1;
  });
  r += 1;
  ws.mergeCells('A' + r + ':D' + r);
  const note = ws.getCell('A' + r);
  note.value = 'Break-even sale ≈ $' + Math.round(c.breakEvenPsf) + '/SF. Proposal for discussion, not an offer. Review with a securities attorney before accepting capital.';
  note.font = { name: FONT, size: 9, italic: true, color: { argb: 'FF666666' } };
}

function sheetChecks(wb, o) {
  const ws = wb.addWorksheet('Underwriting Checks', { views: [{ showGridLines: false }] });
  ws.getColumn(1).width = 48; ws.getColumn(2).width = 14; ws.getColumn(3).width = 14;
  ws.mergeCells('A1:C1'); ws.getCell('A1').value = 'ATERRA BUILDERS'; ws.getCell('A1').font = { name: FONT, size: 16, bold: true };
  ws.mergeCells('A2:C2'); ws.getCell('A2').value = 'Underwriting Checks  —  ' + o.rulesPass + ' of ' + o.rulesTotal + ' passing'; ws.getCell('A2').font = { name: FONT, size: 10, color: { argb: 'FF666666' } };
  let r = 4;
  const hdr = ws.getRow(r); hdr.values = ['Check', 'Value', 'Result'];
  hdr.font = { name: FONT, size: 10, bold: true };
  hdr.eachCell(function (c) { c.border = { bottom: { style: 'thin', color: { argb: 'FF333333' } } }; });
  r += 1;
  o.rules.forEach(function (rule) {
    ws.getCell('A' + r).value = rule.label; ws.getCell('A' + r).font = { name: FONT, size: 10 };
    const v = ws.getCell('B' + r);
    const isMoney = (rule.key === 'dumpster' || rule.key === 'costSf' || rule.key === 'draws');
    v.value = rule.value; v.numFmt = isMoney ? MONEY : PCT; v.font = { name: FONT, size: 10 }; v.alignment = { horizontal: 'right' };
    const res = ws.getCell('C' + r);
    res.value = rule.pass ? 'PASS' : 'REVIEW';
    res.font = { name: FONT, size: 10, bold: true, color: { argb: rule.pass ? 'FF1C6B2C' : 'FFC0402F' } };
    res.alignment = { horizontal: 'center' };
    r += 1;
  });
}
