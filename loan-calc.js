/* ============================================================================
 * loan-calc.js — Aterra Builders construction-loan underwriting engine
 * Pure, dependency-free. Ports the "Loan Summary" workbook math to JavaScript.
 *
 *   var out = LoanCalc.compute(project, budgetLines);
 *
 * `project`     — a row from public.projects (the input "levers").
 * `budgetLines` — rows from public.project_budget_lines ({division, amount,
 *                 draw_number, line_item}).
 * Returns a plain object with every derived figure the admin UI renders, plus
 * a `rules` array (each {key,label,threshold,value,pass}) mirroring the
 * Rules & Thresholds tab. No rounding is applied — format at the edge.
 * ==========================================================================*/
(function (root) {
  'use strict';

  function num(v, d) { v = parseFloat(v); return isFinite(v) ? v : (d || 0); }

  function compute(project, lines) {
    project = project || {};
    lines = Array.isArray(lines) ? lines : [];
    var rules = project.rules || {};

    // ---- inputs -----------------------------------------------------------
    var SF          = num(project.square_footage);
    var purchase    = num(project.purchase_price);           // C20
    var closing     = num(project.closing_costs);            // C21
    var arvPerSf    = num(project.arv_per_sf);
    var rate        = num(project.interest_rate, 0.095);     // C107
    var term        = num(project.term_months, 8);           // C108
    var pointsPct   = num(project.points_pct, 0.015);        // C109
    var adminFee    = num(project.admin_fee, 5000);          // C110
    var contRate    = num(project.contingency_rate, 0.05);   // F112
    var sellPct     = num(project.selling_cost_pct, 0.03);   // C96
    var escrow      = !!project.escrow_interest;             // C125 = "No" when false

    var maxLTC      = num(rules.max_ltc, 0.85);              // Rules C8
    var maxLTARV    = num(rules.max_ltarv, 0.75);            // Rules C9
    var minCont     = num(rules.min_contingency, 0.05);
    var minMargin   = num(rules.min_margin, 0.15);
    var minEquity   = num(rules.min_equity, 0.15);
    var maxCostSf   = num(rules.max_cost_per_sf, 250);
    var maxLineShr  = num(rules.max_line_share, 0.15);
    var maxDumpster = num(rules.max_dumpster, 20000);

    // ---- budget -----------------------------------------------------------
    var hardCost = 0, maxLine = 0, dumpster = 0, divisions = {}, unassigned = 0;
    var draws = [0, 0, 0, 0, 0, 0];                          // draws 1..6 -> idx 0..5
    lines.forEach(function (ln) {
      var amt = num(ln.amount);
      hardCost += amt;
      if (amt > maxLine) maxLine = amt;
      var div = ln.division || 'Unassigned';
      divisions[div] = (divisions[div] || 0) + amt;
      if (/dumpster|haul/i.test(ln.line_item || '')) dumpster += amt;
      var d = parseInt(ln.draw_number, 10);
      if (d >= 1 && d <= 6) draws[d - 1] += amt;
      else if (amt > 0) unassigned += amt;                  // amount with no draw #
    });

    var contingency = hardCost * contRate;                  // B112
    var totalBudget = hardCost + contingency;               // B113 = holdback (loan)
    var ARV = arvPerSf * SF;                                // C40

    // ---- acquisition advance: closed-form LTC solve (workbook C29) --------
    // MIN( costLimb , valueLimb )
    var monthlyCarryFactor = rate * term / 12;              // C107*C108/12
    var costNumer = maxLTC * (
        (purchase + closing + hardCost + contingency) +
        pointsPct * totalBudget +
        adminFee +
        0.5 * monthlyCarryFactor * totalBudget
      ) - totalBudget;
    var costDenom = 1 - maxLTC * (pointsPct + monthlyCarryFactor);
    var costLimb  = costDenom !== 0 ? costNumer / costDenom : 0;
    var valueLimb = maxLTARV * ARV - totalBudget;
    var acqAdvance = Math.min(costLimb, valueLimb);         // C29
    if (!isFinite(acqAdvance)) acqAdvance = 0;

    var holdback  = totalBudget;                            // C30
    var totalLoan = acqAdvance + holdback;                  // C42

    // ---- financing costs --------------------------------------------------
    var avgBalance      = acqAdvance + 0.5 * holdback;      // C111
    var interestReserve = rate * (term / 12) * avgBalance;  // C24 / C112
    var pointsFees      = pointsPct * totalLoan + adminFee; // C25 / C113

    // ---- sources & uses ---------------------------------------------------
    var totalCost = purchase + closing + hardCost + contingency + interestReserve + pointsFees; // C26
    var equity    = totalCost - totalLoan;                  // C45
    var equityPct = totalCost ? equity / totalCost : 0;     // C46
    var LTC       = totalCost ? totalLoan / totalCost : 0;  // C43
    var LTARV     = ARV ? totalLoan / ARV : 0;              // C44

    // ---- closing table ----------------------------------------------------
    var downPayment  = purchase - acqAdvance;               // C70
    var cashToClose  = downPayment + pointsFees + closing;  // C74 (reserve NOT escrowed)
    // total cash into the deal reconciles to equity whether or not escrowed
    var totalCashIn  = cashToClose + interestReserve;       // = equity

    // ---- profit & exit ----------------------------------------------------
    var grossProfit  = ARV - totalCost;                     // C47
    var grossMargin  = ARV ? grossProfit / ARV : 0;         // C48
    var sellingCosts = ARV * sellPct;                       // C97
    var netProfit    = grossProfit - sellingCosts;          // C99
    var netMargin    = ARV ? netProfit / ARV : 0;           // C100
    var cashOnCash   = equity ? netProfit / equity : 0;     // C101
    var breakEven    = (1 - sellPct) ? totalCost / (1 - sellPct) : 0;
    var overrunCush  = (hardCost + contingency) ? netProfit / (hardCost + contingency) : 0; // C102

    // ---- leverage test ----------------------------------------------------
    var ceilingCost  = maxLTC * totalCost;                  // C84
    var ceilingValue = maxLTARV * ARV;                      // C85
    var maxLoan      = Math.min(ceilingCost, ceilingValue); // C87
    var binding      = ceilingCost < ceilingValue ? 'Cost test (LTC)' : 'Value test (LTARV)';
    var maxAcqAvail  = maxLoan - totalBudget;               // C89
    var minDown      = purchase - maxAcqAvail;              // C90

    // ---- draw schedule (loan-funded reconciliation) -----------------------
    var drawTotal = draws.reduce(function (a, b) { return a + b; }, 0);
    var drawVariance = hardCost - drawTotal;                // must be 0
    var cum = 0;
    var drawRows = draws.map(function (amt, i) {
      cum += amt;
      return { n: i + 1, amount: amt, cumulative: cum, pct: hardCost ? amt / hardCost : 0,
               cumPct: hardCost ? cum / hardCost : 0 };
    });

    // ---- rules & thresholds (mirror of the Rules tab) ---------------------
    var lineShare = hardCost ? maxLine / hardCost : 0;
    var costPerSf = SF ? hardCost / SF : 0;
    var rulesOut = [
      { key: 'dumpster', label: 'Dumpster / haul-off within limit', threshold: maxDumpster,
        value: dumpster, pass: dumpster <= maxDumpster },
      { key: 'contingency', label: 'Contingency rate at or above minimum', threshold: minCont,
        value: contRate, pass: contRate >= minCont },
      { key: 'lineShare', label: 'No single line exceeds share of hard costs', threshold: maxLineShr,
        value: lineShare, pass: lineShare <= maxLineShr },
      { key: 'ltc', label: 'Loan-to-Cost within threshold', threshold: maxLTC,
        value: LTC, pass: LTC <= maxLTC + 0.0001 },
      { key: 'ltarv', label: 'Loan-to-ARV within threshold', threshold: maxLTARV,
        value: LTARV, pass: ARV > 0 && LTARV <= maxLTARV },
      { key: 'margin', label: 'Gross margin on ARV at or above minimum', threshold: minMargin,
        value: grossMargin, pass: ARV > 0 && grossMargin >= minMargin },
      { key: 'costSf', label: 'Hard cost per SF within benchmark', threshold: maxCostSf,
        value: costPerSf, pass: SF > 0 && costPerSf <= maxCostSf },
      { key: 'equity', label: 'Borrower equity at or above minimum share', threshold: minEquity,
        value: equityPct, pass: equityPct >= minEquity - 0.0001 },
      { key: 'draws', label: 'Every budget line assigned to a draw', threshold: 0,
        value: unassigned, pass: unassigned === 0 && Math.abs(drawVariance) < 1 }
    ];
    var rulesPass = rulesOut.filter(function (r) { return r.pass; }).length;

    return {
      SF: SF, ARV: ARV, arvPerSf: arvPerSf,
      hardCost: hardCost, contingency: contingency, totalBudget: totalBudget,
      contRate: contRate, costPerSf: costPerSf, divisions: divisions, unassigned: unassigned,
      acqAdvance: acqAdvance, holdback: holdback, totalLoan: totalLoan,
      interestReserve: interestReserve, pointsFees: pointsFees, avgBalance: avgBalance,
      totalCost: totalCost, equity: equity, equityPct: equityPct, LTC: LTC, LTARV: LTARV,
      downPayment: downPayment, cashToClose: cashToClose, totalCashIn: totalCashIn,
      escrow: escrow,
      grossProfit: grossProfit, grossMargin: grossMargin, sellingCosts: sellingCosts,
      netProfit: netProfit, netMargin: netMargin, cashOnCash: cashOnCash,
      breakEven: breakEven, overrunCushion: overrunCush,
      ceilingCost: ceilingCost, ceilingValue: ceilingValue, maxLoan: maxLoan,
      binding: binding, maxAcqAvail: maxAcqAvail, minDown: minDown,
      draws: drawRows, drawTotal: drawTotal, drawVariance: drawVariance,
      rules: rulesOut, rulesPass: rulesPass, rulesTotal: rulesOut.length,
      sellPct: sellPct,
      // balance check: sources (loan + equity) less uses must be ~0
      balance: (totalLoan + equity) - totalCost
    };
  }

  // Capital-partner economics — layered on top of a compute() result.
  function capital(o, c) {
    c = c || {};
    var np = num(c.num_partners, 2), cpp = num(c.capital_per_partner, 300000),
        wc = num(c.working_capital, 130000), hold = num(c.hold_months, 10),
        ownEach = num(c.ownership_per_capital, 0.125), ops = num(c.operating_partners, 3);
    var raised = np * cpp;
    var cashNeed = o.equity + wc;                 // partnership funds equity + draw float
    var capOwnTotal = np * ownEach;
    var opOwnTotal = 1 - capOwnTotal;
    var opEach = ops > 0 ? opOwnTotal / ops : 0;
    var profitPerCap = o.netProfit * ownEach;
    var roc = cpp ? profitPerCap / cpp : 0;
    var factors = [1.05, 1.0, 0.95, 0.90, 0.85];
    var downside = factors.map(function (f) {
      var psf = o.arvPerSf * f;
      var netP = (psf * o.SF) * (1 - o.sellPct) - o.totalCost;
      return { psf: psf, sale: psf * o.SF, netProfit: netP,
               perCapital: netP * ownEach, roc: cpp ? (netP * ownEach) / cpp : 0, base: f === 1.0 };
    });
    return {
      np: np, cpp: cpp, wc: wc, hold: hold, ops: ops, ownEach: ownEach,
      raised: raised, cashNeed: cashNeed, surplus: raised - cashNeed,
      capOwnTotal: capOwnTotal, opOwnTotal: opOwnTotal, opEach: opEach,
      profitPerCap: profitPerCap, roc: roc, annual: hold ? roc * 12 / hold : 0,
      profitPerOp: o.netProfit * opEach, seniorLoan: o.totalLoan,
      breakEvenPsf: o.SF ? o.breakEven / o.SF : 0, downside: downside
    };
  }

  root.LoanCalc = { compute: compute, capital: capital };
})(typeof window !== 'undefined' ? window : this);
