// ============================================================================
// loan-export.js — generate a formatted .xlsx construction-loan package from a
// project. Reads the project + budget lines from Supabase using the CALLER's
// bearer token (so row-level security enforces admin-only access), runs the
// shared LoanCalc engine, and returns a multi-tab workbook styled to match the
// Aterra "Construction Loan Package" workbook.
// ============================================================================
const ExcelJS = require('exceljs');
const LoanCalc = require('../../loan-calc.js');

const SB = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;

const FONT = 'Arial';
// palette lifted from the source workbook
const T = {
  navy: 'FF1F3864', navy2: 'FF2F4A6D', ltblue: 'FFDCE6F1', sub: 'FFEDF1F7',
  faint: 'FFF2F5F9', yellow: 'FFFFF2CC', blue: 'FF0000FF', gray: 'FF808080',
  white: 'FFFFFFFF', black: 'FF000000', green: 'FF1C6B2C', red: 'FFC0402F'
};
const MONEY = '$#,##0;("$"#,##0);-';
const MONEY2 = '$#,##0.00;("$"#,##0.00);-';
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
// styling helpers
// ---------------------------------------------------------------------------
function solid(argb) { return { type: 'pattern', pattern: 'solid', fgColor: { argb: argb } }; }
function num(v) { v = parseFloat(v); return isFinite(v) ? v : 0; }

function put(ws, r, c, v, o) {
  o = o || {};
  const cell = ws.getCell(r, c);
  cell.value = (v === undefined ? null : v);
  cell.font = { name: FONT, size: o.size || 10, bold: !!o.bold, italic: !!o.italic, color: { argb: o.color || T.black } };
  if (o.fill) cell.fill = solid(o.fill);
  if (o.fmt) cell.numFmt = o.fmt;
  cell.alignment = { horizontal: o.align || 'left', vertical: 'middle', wrapText: !!o.wrap };
  if (o.top) cell.border = { top: { style: 'thin', color: { argb: 'FF9AA6B2' } } };
  return cell;
}

function band(ws, r, c1, c2, text, o) {
  o = o || {};
  ws.mergeCells(r, c1, r, c2);
  put(ws, r, c1, text, { size: o.size || 13, bold: o.bold !== false, color: o.color || T.white, fill: o.fill || T.navy2 });
  ws.getRow(r).height = o.height || 19;
}

function titleBand(ws, lastCol, titleText, subtitle) {
  ws.mergeCells(1, 1, 1, lastCol);
  put(ws, 1, 1, titleText, { size: 16, bold: true, color: T.white, fill: T.navy });
  ws.getRow(1).height = 26;
  ws.mergeCells(2, 1, 2, lastCol);
  put(ws, 2, 1, subtitle, { size: 11, color: T.white, fill: T.navy2 });
  ws.getRow(2).height = 18;
}

// label in col `lc`, value in col `vc`
function kv(ws, r, lc, label, vc, value, fmt, o) {
  o = o || {};
  put(ws, r, lc, label, { size: 10, bold: !!o.bold, color: o.lcolor });
  put(ws, r, vc, value, { size: 10, bold: !!o.bold, fmt: fmt, align: 'right', fill: o.vfill, color: o.vcolor, top: o.top });
  if (o.top) ws.getCell(r, lc).border = { top: { style: 'thin', color: { argb: 'FF9AA6B2' } } };
}

// highlight a value cell like a source-workbook input (blue text on yellow)
function inputV(ws, r, vc) {
  const cell = ws.getCell(r, vc);
  cell.fill = solid(T.yellow);
  cell.font = { name: FONT, size: 10, color: { argb: T.blue } };
}

// ---------------------------------------------------------------------------
function buildWorkbook(p, lines, o, cap) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Aterra Builders';
  sheetLenderPackage(wb, p, o);
  sheetLoanSummary(wb, p, o);
  sheetBudget(wb, p, lines, o);
  sheetDraws(wb, o);
  sheetRules(wb, o);
  sheetCapital(wb, p, o, cap);
  sheetReo(wb, p);
  sheetDocs(wb, p);
  return wb;
}

function subLine(p) {
  return (p.scope || '') + (p.square_footage ? '  •  ' + Number(p.square_footage).toLocaleString() + ' SF' : '') + (p.beds_baths ? '  •  ' + p.beds_baths : '');
}

// ---- Lender Package (one-pager) -------------------------------------------
function sheetLenderPackage(wb, p, o) {
  const ws = wb.addWorksheet('Lender Package', { views: [{ showGridLines: false }] });
  ws.getColumn(1).width = 3; ws.getColumn(2).width = 46; ws.getColumn(3).width = 20; ws.getColumn(4).width = 12;
  titleBand(ws, 4, 'CONSTRUCTION LOAN REQUEST', 'Aterra Builders  •  ' + (p.address || ''));
  let r = 4;
  band(ws, r, 2, 4, 'PROPERTY & PROJECT'); r++;
  kv(ws, r++, 2, 'Subject Property', 3, p.address || '');
  kv(ws, r++, 2, 'Borrower / Builder', 3, p.borrower || '');
  kv(ws, r++, 2, 'Scope of Work', 3, p.scope || '');
  kv(ws, r++, 2, 'Completed Square Footage', 3, o.SF, '#,##0');
  kv(ws, r++, 2, 'Bedrooms / Bathrooms', 3, p.beds_baths || '');
  kv(ws, r++, 2, 'Construction Term', 3, (p.term_months || '') + ' months');
  kv(ws, r++, 2, 'Estimated After Repair Value', 3, o.ARV, MONEY);
  kv(ws, r++, 2, 'ARV per Square Foot', 3, o.arvPerSf, MONEY);
  r++;
  band(ws, r, 2, 4, 'LOAN REQUEST'); r++;
  kv(ws, r++, 2, 'Purchase Price / As-Is Value', 3, p.purchase_price, MONEY);
  kv(ws, r++, 2, 'Acquisition Advance Requested', 3, o.acqAdvance, MONEY);
  kv(ws, r++, 2, 'Construction Holdback Requested', 3, o.holdback, MONEY);
  kv(ws, r++, 2, 'TOTAL LOAN REQUESTED', 3, o.totalLoan, MONEY, { bold: true, top: true });
  kv(ws, r++, 2, 'Borrower Cash Equity', 3, o.equity, MONEY);
  kv(ws, r++, 2, 'Borrower Equity as % of Total Cost', 3, o.equityPct, PCT);
  kv(ws, r++, 2, 'Loan-to-Cost', 3, o.LTC, PCT);
  kv(ws, r++, 2, 'Loan-to-ARV', 3, o.LTARV, PCT);
  r++;
  band(ws, r, 2, 4, 'CONSTRUCTION BUDGET BY DIVISION'); r++;
  put(ws, r, 2, 'Division', { bold: true, fill: T.ltblue });
  put(ws, r, 3, 'Amount', { bold: true, fill: T.ltblue, align: 'right' });
  put(ws, r, 4, '% Budget', { bold: true, fill: T.ltblue, align: 'right' }); r++;
  Object.keys(o.divisions).sort().forEach(function (d) {
    put(ws, r, 2, d, { size: 10 });
    put(ws, r, 3, o.divisions[d], { fmt: MONEY, align: 'right' });
    put(ws, r, 4, o.hardCost ? o.divisions[d] / o.hardCost : 0, { fmt: PCT, align: 'right' });
    r++;
  });
  kv(ws, r++, 2, 'Subtotal — Hard Construction Costs', 3, o.hardCost, MONEY, { bold: true, top: true });
  kv(ws, r++, 2, 'Contingency', 3, o.contingency, MONEY);
  kv(ws, r++, 2, 'TOTAL CONSTRUCTION BUDGET', 3, o.totalBudget, MONEY, { bold: true, top: true });
  kv(ws, r++, 2, 'Cost per Square Foot', 3, o.costPerSf, MONEY2);
  r++;
  band(ws, r, 2, 4, 'DRAW SCHEDULE SUMMARY'); r++;
  put(ws, r, 2, 'Draw', { bold: true, fill: T.ltblue });
  put(ws, r, 3, 'Amount', { bold: true, fill: T.ltblue, align: 'right' });
  put(ws, r, 4, 'Cum %', { bold: true, fill: T.ltblue, align: 'right' }); r++;
  o.draws.forEach(function (d) {
    put(ws, r, 2, 'Draw ' + d.n, { size: 10 });
    put(ws, r, 3, d.amount, { fmt: MONEY, align: 'right' });
    put(ws, r, 4, d.cumPct, { fmt: PCT, align: 'right' });
    r++;
  });
}

// ---- Loan Summary ----------------------------------------------------------
function sheetLoanSummary(wb, p, o) {
  const ws = wb.addWorksheet('Loan Summary', { views: [{ showGridLines: false }] });
  ws.getColumn(1).width = 3; ws.getColumn(2).width = 52; ws.getColumn(3).width = 20; ws.getColumn(4).width = 3;
  titleBand(ws, 4, 'ATERRA BUILDERS — CONSTRUCTION LOAN REQUEST', subLine(p));
  let r = 4;
  band(ws, r, 2, 3, 'PROJECT SNAPSHOT'); r++;
  kv(ws, r++, 2, 'Borrower / Builder', 3, p.borrower || '');
  kv(ws, r++, 2, 'Project Scope', 3, p.scope || '');
  kv(ws, r++, 2, 'Completed Square Footage', 3, o.SF, '#,##0');
  kv(ws, r++, 2, 'Bedrooms / Bathrooms', 3, p.beds_baths || '');
  kv(ws, r++, 2, 'Construction Term (months)', 3, p.term_months || '');
  r++;
  band(ws, r, 2, 3, 'SOURCES AND USES OF FUNDS'); r++;
  band(ws, r, 2, 3, 'USES OF FUNDS', { fill: T.ltblue, color: T.black }); r++;
  kv(ws, r, 2, 'Land / Lot Acquisition Cost', 3, p.purchase_price, MONEY); inputV(ws, r, 3); r++;
  kv(ws, r++, 2, 'Acquisition Closing Costs, Title & Survey', 3, p.closing_costs, MONEY);
  kv(ws, r++, 2, 'Hard Construction Costs', 3, o.hardCost, MONEY);
  kv(ws, r++, 2, 'Construction Contingency', 3, o.contingency, MONEY);
  kv(ws, r++, 2, 'Interest Reserve (carry during construction)', 3, o.interestReserve, MONEY);
  kv(ws, r++, 2, 'Lender Points, Origination & Closing Fees', 3, o.pointsFees, MONEY);
  kv(ws, r++, 2, 'TOTAL PROJECT COST', 3, o.totalCost, MONEY, { bold: true, top: true });
  r++;
  band(ws, r, 2, 3, 'SOURCES OF FUNDS', { fill: T.ltblue, color: T.black }); r++;
  kv(ws, r++, 2, 'Hard Money Loan — Acquisition Advance', 3, o.acqAdvance, MONEY);
  kv(ws, r++, 2, 'Hard Money Loan — Construction Holdback', 3, o.holdback, MONEY);
  kv(ws, r++, 2, 'Borrower Equity — Cash at Closing & carry', 3, o.equity, MONEY);
  kv(ws, r++, 2, 'TOTAL SOURCES', 3, o.totalLoan + o.equity, MONEY, { bold: true, top: true });
  kv(ws, r++, 2, 'Balance Check (Sources less Uses)', 3, o.balance, MONEY);
  r++;
  band(ws, r, 2, 3, 'KEY UNDERWRITING METRICS'); r++;
  kv(ws, r++, 2, 'Hard Construction Cost per SF', 3, o.costPerSf, MONEY2);
  kv(ws, r++, 2, 'All-In Project Cost per SF', 3, o.SF ? o.totalCost / o.SF : 0, MONEY2);
  kv(ws, r, 2, 'After Repair Value (ARV)', 3, o.ARV, MONEY); inputV(ws, r, 3); r++;
  kv(ws, r++, 2, 'ARV per SF', 3, o.arvPerSf, MONEY);
  kv(ws, r++, 2, 'Total Loan Amount', 3, o.totalLoan, MONEY, { bold: true });
  kv(ws, r++, 2, 'Loan-to-Cost (LTC)', 3, o.LTC, PCT);
  kv(ws, r++, 2, 'Loan-to-ARV (LTARV)', 3, o.LTARV, PCT);
  kv(ws, r++, 2, 'Total Borrower Equity', 3, o.equity, MONEY);
  kv(ws, r++, 2, 'Borrower Equity as % of Cost', 3, o.equityPct, PCT);
  kv(ws, r++, 2, 'Projected Gross Profit', 3, o.grossProfit, MONEY);
  kv(ws, r++, 2, 'Projected Gross Margin on ARV', 3, o.grossMargin, PCT);
  r++;
  band(ws, r, 2, 3, 'FINANCING COST CALCULATOR'); r++;
  kv(ws, r, 2, 'Interest rate (annual)', 3, p.interest_rate, PCT); inputV(ws, r, 3); r++;
  kv(ws, r, 2, 'Term (months)', 3, p.term_months, '0'); inputV(ws, r, 3); r++;
  kv(ws, r, 2, 'Lender points (% of loan)', 3, p.points_pct, PCT); inputV(ws, r, 3); r++;
  kv(ws, r, 2, 'Admin / doc / processing fee', 3, p.admin_fee, MONEY); inputV(ws, r, 3); r++;
  kv(ws, r++, 2, 'Average outstanding balance', 3, o.avgBalance, MONEY);
  kv(ws, r++, 2, 'Interest reserve required', 3, o.interestReserve, MONEY);
  kv(ws, r++, 2, 'Lender points and fees', 3, o.pointsFees, MONEY);
  r++;
  band(ws, r, 2, 3, 'CLOSING TABLE'); r++;
  kv(ws, r++, 2, 'Purchase Price / As-Is Value', 3, p.purchase_price, MONEY);
  kv(ws, r++, 2, 'Lender Acquisition Advance', 3, o.acqAdvance, MONEY);
  kv(ws, r++, 2, 'Borrower Down Payment', 3, o.downPayment, MONEY, { bold: true });
  kv(ws, r++, 2, 'Plus: Lender Points, Origination & Fees', 3, o.pointsFees, MONEY);
  kv(ws, r++, 2, 'Plus: Title, Escrow, Survey & Prepaids', 3, p.closing_costs, MONEY);
  kv(ws, r++, 2, 'Estimated Cash to Close', 3, o.cashToClose, MONEY, { bold: true, top: true });
  kv(ws, r++, 2, 'Plus: Interest paid monthly over build', 3, o.interestReserve, MONEY);
  kv(ws, r++, 2, 'Total Borrower Cash into the Deal', 3, o.totalCashIn, MONEY, { bold: true, top: true });
  r++;
  band(ws, r, 2, 3, 'EXIT MATH'); r++;
  kv(ws, r, 2, 'Selling costs as % of ARV', 3, o.sellPct, PCT); inputV(ws, r, 3); r++;
  kv(ws, r++, 2, 'Estimated selling costs', 3, o.sellingCosts, MONEY);
  kv(ws, r++, 2, 'Net profit after sale', 3, o.netProfit, MONEY, { bold: true });
  kv(ws, r++, 2, 'Net margin on ARV', 3, o.netMargin, PCT);
  kv(ws, r++, 2, 'Cash-on-cash return on equity', 3, o.cashOnCash, PCT);
  kv(ws, r++, 2, 'Break-even sale price', 3, o.breakEven, MONEY);
  r++;
  put(ws, r, 2, 'Legend:  yellow = input cell.  All other figures are calculated from the project data.', { size: 9, color: T.gray, italic: true });
}

// ---- Construction Budget ---------------------------------------------------
function sheetBudget(wb, p, lines, o) {
  const ws = wb.addWorksheet('Construction Budget', { views: [{ showGridLines: false }] });
  ws.getColumn(1).width = 46; ws.getColumn(2).width = 16; ws.getColumn(3).width = 11; ws.getColumn(4).width = 11; ws.getColumn(5).width = 8; ws.getColumn(6).width = 34;
  titleBand(ws, 6, 'DETAILED CONSTRUCTION BUDGET — BY TRADE DIVISION', subLine(p));
  let r = 4;
  ['Line Item', 'Amount ($)', '% Budget', 'Cost / SF', 'Draw #', 'Scope Notes'].forEach(function (t, i) {
    put(ws, r, i + 1, t, { bold: true, color: T.white, fill: T.navy2, align: i === 0 || i === 5 ? 'left' : 'right' });
  });
  r++;
  const byDiv = {};
  (lines || []).forEach(function (l) { const d = l.division || 'Other'; (byDiv[d] = byDiv[d] || []).push(l); });
  Object.keys(byDiv).sort().forEach(function (d) {
    ws.mergeCells(r, 1, r, 6);
    put(ws, r, 1, d, { bold: true, color: T.navy, fill: T.ltblue }); r++;
    byDiv[d].forEach(function (l) {
      const amt = Number(l.amount) || 0;
      put(ws, r, 1, l.line_item || '', { size: 10 });
      put(ws, r, 2, amt, { fmt: MONEY, align: 'right' });
      put(ws, r, 3, o.hardCost ? amt / o.hardCost : 0, { fmt: PCT, align: 'right', fill: T.faint });
      put(ws, r, 4, o.SF ? amt / o.SF : 0, { fmt: MONEY2, align: 'right', fill: T.faint });
      put(ws, r, 5, l.draw_number || '', { align: 'center' });
      put(ws, r, 6, l.scope_notes || '', { size: 10, color: T.gray });
      r++;
    });
    put(ws, r, 1, '    Subtotal — ' + d, { bold: true, italic: true, fill: T.sub, color: T.navy });
    put(ws, r, 2, o.divisions[d] || 0, { fmt: MONEY, align: 'right', bold: true, fill: T.sub });
    put(ws, r, 3, '', { fill: T.sub }); put(ws, r, 4, '', { fill: T.sub }); put(ws, r, 5, '', { fill: T.sub }); put(ws, r, 6, '', { fill: T.sub });
    r++;
  });
  r++;
  put(ws, r, 1, 'SUBTOTAL — HARD CONSTRUCTION COSTS', { bold: true, fill: T.ltblue });
  put(ws, r, 2, o.hardCost, { fmt: MONEY, align: 'right', bold: true, fill: T.ltblue });
  put(ws, r, 3, '', { fill: T.ltblue }); put(ws, r, 4, '', { fill: T.ltblue }); put(ws, r, 5, '', { fill: T.ltblue }); put(ws, r, 6, '', { fill: T.ltblue }); r++;
  put(ws, r, 1, 'CONSTRUCTION CONTINGENCY (' + Math.round(o.contRate * 100) + '%)', { bold: true });
  put(ws, r, 2, o.contingency, { fmt: MONEY, align: 'right', bold: true }); r++;
  put(ws, r, 1, 'TOTAL CONSTRUCTION BUDGET', { bold: true, color: T.white, fill: T.navy });
  put(ws, r, 2, o.totalBudget, { fmt: MONEY, align: 'right', bold: true, color: T.white, fill: T.navy });
  put(ws, r, 3, '', { fill: T.navy }); put(ws, r, 4, '', { fill: T.navy }); put(ws, r, 5, '', { fill: T.navy });
  put(ws, r, 6, (o.costPerSf ? '$' + o.costPerSf.toFixed(2) + '/SF' : ''), { color: T.white, fill: T.navy, align: 'right' });
}

// ---- Draw Schedule ---------------------------------------------------------
function sheetDraws(wb, o) {
  const ws = wb.addWorksheet('Draw Schedule', { views: [{ showGridLines: false }] });
  ws.getColumn(1).width = 12; ws.getColumn(2).width = 18; ws.getColumn(3).width = 16; ws.getColumn(4).width = 12;
  titleBand(ws, 4, 'CONSTRUCTION DRAW SCHEDULE', 'Draws sized by formula from the budget line items');
  let r = 4;
  ['Draw', 'Amount', 'Cumulative', 'Cum %'].forEach(function (t, i) {
    put(ws, r, i + 1, t, { bold: true, color: T.white, fill: T.navy2, align: i === 0 ? 'left' : 'right' });
  });
  r++;
  o.draws.forEach(function (d) {
    put(ws, r, 1, 'Draw ' + d.n, { size: 10 });
    put(ws, r, 2, d.amount, { fmt: MONEY, align: 'right' });
    put(ws, r, 3, d.cumulative, { fmt: MONEY, align: 'right' });
    put(ws, r, 4, d.cumPct, { fmt: PCT, align: 'right' });
    r++;
  });
  put(ws, r, 1, 'Total', { bold: true, top: true });
  put(ws, r, 2, o.drawTotal, { fmt: MONEY, align: 'right', bold: true, top: true });
  ws.getCell(r, 3).border = ws.getCell(r, 4).border = { top: { style: 'thin', color: { argb: 'FF9AA6B2' } } };
}

// ---- Rules & Thresholds ----------------------------------------------------
function sheetRules(wb, o) {
  const ws = wb.addWorksheet('Rules & Thresholds', { views: [{ showGridLines: false }] });
  ws.getColumn(1).width = 52; ws.getColumn(2).width = 16; ws.getColumn(3).width = 12;
  titleBand(ws, 3, 'RULES & THRESHOLDS', o.rulesPass + ' of ' + o.rulesTotal + ' checks passing');
  let r = 4;
  ['Check', 'Value', 'Result'].forEach(function (t, i) {
    put(ws, r, i + 1, t, { bold: true, color: T.white, fill: T.navy2, align: i === 0 ? 'left' : (i === 1 ? 'right' : 'center') });
  });
  r++;
  o.rules.forEach(function (rule) {
    const isMoney = (rule.key === 'dumpster' || rule.key === 'costSf' || rule.key === 'draws');
    put(ws, r, 1, rule.label, { size: 10 });
    put(ws, r, 2, rule.value, { fmt: isMoney ? MONEY : PCT, align: 'right' });
    put(ws, r, 3, rule.pass ? 'PASS' : 'REVIEW', { bold: true, align: 'center', color: rule.pass ? T.green : T.red });
    r++;
  });
}

// ---- Capital Partners ------------------------------------------------------
function sheetCapital(wb, p, o, c) {
  const ws = wb.addWorksheet('Capital Partners', { views: [{ showGridLines: false }] });
  ws.getColumn(1).width = 40; ws.getColumn(2).width = 18; ws.getColumn(3).width = 14; ws.getColumn(4).width = 16;
  titleBand(ws, 4, 'CAPITAL PARTNER OPPORTUNITY', subLine(p));
  let r = 4;
  band(ws, r, 1, 4, 'CAPITAL STACK'); r++;
  kv(ws, r++, 1, 'Senior construction loan (first lien)', 2, c.seniorLoan, MONEY);
  kv(ws, r++, 1, 'Partner capital raised', 2, c.raised, MONEY);
  kv(ws, r++, 1, 'Total capitalization', 2, c.seniorLoan + c.raised, MONEY, { bold: true, top: true });
  r++;
  band(ws, r, 1, 4, 'CASH NEED & RESERVE'); r++;
  kv(ws, r++, 1, 'Cash required (equity + working capital)', 2, c.cashNeed, MONEY);
  kv(ws, r++, 1, 'Capital raised', 2, c.raised, MONEY);
  kv(ws, r++, 1, 'Reserve / (shortfall)', 2, c.surplus, MONEY, { bold: true, top: true });
  r++;
  band(ws, r, 1, 4, 'PROJECTED RETURNS'); r++;
  kv(ws, r++, 1, 'Net profit to partnership', 2, o.netProfit, MONEY);
  kv(ws, r++, 1, 'Profit per capital partner', 2, c.profitPerCap, MONEY);
  kv(ws, r++, 1, 'Return on capital', 2, c.roc, PCT);
  kv(ws, r++, 1, 'Annualized return', 2, c.annual, PCT);
  r++;
  band(ws, r, 1, 4, 'PARTNER SUMMARY'); r++;
  ['Partner', 'Capital In', 'Ownership', 'Proj. Profit'].forEach(function (t, i) {
    put(ws, r, i + 1, t, { bold: true, color: T.white, fill: T.navy2, align: i === 0 ? 'left' : 'right' });
  });
  r++;
  for (let i = 1; i <= c.ops; i++) {
    put(ws, r, 1, 'Operating partner ' + i, { size: 10 });
    put(ws, r, 2, '—', { align: 'right' });
    put(ws, r, 3, c.opEach, { fmt: PCT, align: 'right' });
    put(ws, r, 4, c.profitPerOp, { fmt: MONEY, align: 'right' });
    r++;
  }
  for (let j = 1; j <= c.np; j++) {
    put(ws, r, 1, 'Capital partner ' + j, { size: 10 });
    put(ws, r, 2, c.cpp, { fmt: MONEY, align: 'right' });
    put(ws, r, 3, c.ownEach, { fmt: PCT, align: 'right' });
    put(ws, r, 4, c.profitPerCap, { fmt: MONEY, align: 'right' });
    r++;
  }
  r++;
  band(ws, r, 1, 4, 'DOWNSIDE — SALE PRICE SENSITIVITY'); r++;
  ['Sale $/SF', 'Sale price', 'Net profit', 'Per partner'].forEach(function (t, i) {
    put(ws, r, i + 1, t, { bold: true, color: T.white, fill: T.navy2, align: i === 0 ? 'left' : 'right' });
  });
  r++;
  c.downside.forEach(function (d) {
    put(ws, r, 1, Math.round(d.psf), { align: 'left' });
    put(ws, r, 2, d.sale, { fmt: MONEY, align: 'right' });
    put(ws, r, 3, d.netProfit, { fmt: MONEY, align: 'right' });
    put(ws, r, 4, d.perCapital, { fmt: MONEY, align: 'right' });
    r++;
  });
  r++;
  ws.mergeCells(r, 1, r, 4);
  put(ws, r, 1, 'Break-even sale ≈ $' + Math.round(c.breakEvenPsf) + '/SF. Proposal for discussion, not an offer. Review with a securities attorney before accepting capital.', { size: 9, italic: true, color: T.gray, wrap: true });
}

// ---- REO & Track Record ----------------------------------------------------
function sheetReo(wb, p) {
  const reo = p.reo || {};
  const ws = wb.addWorksheet('REO & Track Record', { views: [{ showGridLines: false }] });
  ws.getColumn(1).width = 34;
  for (let c = 2; c <= 9; c++) ws.getColumn(c).width = 14;
  titleBand(ws, 9, 'SCHEDULE OF REAL ESTATE OWNED & TRACK RECORD', 'Guarantor: ' + (reo.guarantor || '______________'));
  let r = 4;
  band(ws, r, 1, 9, 'SECTION A — REAL ESTATE CURRENTLY OWNED'); r++;
  ['Address', 'Type', 'Acquired', 'Purchase', 'Market Value', 'Loan Balance', 'Lender', 'Monthly Pmt', 'Monthly Rent']
    .forEach(function (t, i) { put(ws, r, i + 1, t, { bold: true, color: T.navy, fill: T.ltblue, align: i >= 3 && i !== 6 ? 'right' : 'left' }); });
  r++;
  const secA = reo.section_a || [];
  secA.forEach(function (x) {
    put(ws, r, 1, x.address || '', { size: 10 }); put(ws, r, 2, x.type || '', { size: 10 }); put(ws, r, 3, x.acquired || '', { size: 10 });
    put(ws, r, 4, num(x.purchase), { fmt: MONEY, align: 'right' }); put(ws, r, 5, num(x.value), { fmt: MONEY, align: 'right' });
    put(ws, r, 6, num(x.loan), { fmt: MONEY, align: 'right' }); put(ws, r, 7, x.lender || '', { size: 10 });
    put(ws, r, 8, num(x.payment), { fmt: MONEY, align: 'right' }); put(ws, r, 9, num(x.rent), { fmt: MONEY, align: 'right' });
    r++;
  });
  if (!secA.length) { ws.mergeCells(r, 1, r, 9); put(ws, r, 1, '(none reported — a blank Section A is a valid submission)', { italic: true, color: T.gray }); r++; }
  r++;
  band(ws, r, 1, 9, 'SECTION B — CLOSED TRANSACTION HISTORY'); r++;
  ['Address', 'Role', 'Sale Price', 'Close Date', 'Year', 'Notes']
    .forEach(function (t, i) { put(ws, r, i + 1, t, { bold: true, color: T.navy, fill: T.ltblue, align: i === 2 ? 'right' : 'left' }); });
  r++;
  const secB = reo.section_b || []; let bTotal = 0;
  secB.forEach(function (x) {
    put(ws, r, 1, x.address || '', { size: 10 }); put(ws, r, 2, x.role || '', { size: 10 });
    put(ws, r, 3, num(x.price), { fmt: MONEY, align: 'right' }); put(ws, r, 4, x.close_date || '', { size: 10 });
    put(ws, r, 5, x.year || '', { size: 10 }); put(ws, r, 6, x.notes || '', { size: 10, color: T.gray });
    bTotal += num(x.price); r++;
  });
  if (secB.length) { put(ws, r, 1, secB.length + ' closings', { bold: true, top: true }); put(ws, r, 3, bTotal, { fmt: MONEY, align: 'right', bold: true, top: true }); r++; }
  r++;
  band(ws, r, 1, 9, 'SECTION C — GROUND-UP CONSTRUCTION TRACK RECORD'); r++;
  ['Project', 'Scope', 'Start', 'Completion', 'Budget', 'Actual', 'Sale', 'Months', 'Lender']
    .forEach(function (t, i) { put(ws, r, i + 1, t, { bold: true, color: T.navy, fill: T.ltblue, align: i >= 4 && i <= 6 ? 'right' : 'left' }); });
  r++;
  const secC = reo.section_c || [];
  secC.forEach(function (x) {
    put(ws, r, 1, x.address || '', { size: 10 }); put(ws, r, 2, x.scope || '', { size: 10 }); put(ws, r, 3, x.start || '', { size: 10 });
    put(ws, r, 4, x.completion || '', { size: 10 }); put(ws, r, 5, num(x.budget), { fmt: MONEY, align: 'right' });
    put(ws, r, 6, num(x.actual), { fmt: MONEY, align: 'right' }); put(ws, r, 7, num(x.sale), { fmt: MONEY, align: 'right' });
    put(ws, r, 8, x.months || '', { size: 10 }); put(ws, r, 9, x.lender || '', { size: 10 });
    r++;
  });
  if (!secC.length) { ws.mergeCells(r, 1, r, 9); put(ws, r, 1, '(none — support with the GC portfolio, license and comps of similar scope)', { italic: true, color: T.gray }); r++; }
}

// ---- Document Tracker ------------------------------------------------------
function sheetDocs(wb, p) {
  const docs = Array.isArray(p.documents) ? p.documents : [];
  const ws = wb.addWorksheet('Document Tracker', { views: [{ showGridLines: false }] });
  ws.getColumn(1).width = 46; ws.getColumn(2).width = 18; ws.getColumn(3).width = 14; ws.getColumn(4).width = 14; ws.getColumn(5).width = 32;
  titleBand(ws, 5, 'LENDER SUBMISSION TRACKER', 'Internal working document');
  let r = 4;
  ['Document', 'Responsible', 'Status', 'Date Sent', 'Notes']
    .forEach(function (t, i) { put(ws, r, i + 1, t, { bold: true, color: T.white, fill: T.navy2 }); });
  r++;
  docs.forEach(function (d) {
    put(ws, r, 1, d.name || '', { size: 10 });
    put(ws, r, 2, d.responsible || '', { size: 10 });
    put(ws, r, 3, d.status || '', { size: 10, color: d.status === 'Sent' ? T.green : (d.status === 'In progress' ? 'FFB8791F' : T.black) });
    put(ws, r, 4, d.date_sent || '', { size: 10 });
    put(ws, r, 5, d.notes || '', { size: 10, color: T.gray });
    r++;
  });
}
