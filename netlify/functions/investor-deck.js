/* netlify/functions/investor-deck.js
   Serves the PRIVATE investor deck only for a valid, active access token.
   The deck HTML lives here (server-side) — it is never in a public file and
   is only returned after the token is validated against Supabase.

   Requires Netlify env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
   Access:  /invest?key=TOKEN   (redirected to this function) */

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const page = (body) => ({
  statusCode: 200,
  headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'X-Robots-Tag': 'noindex, nofollow',
    'Cache-Control': 'no-store, max-age=0',
    'Referrer-Policy': 'no-referrer'
  },
  body
});

exports.handler = async (event) => {
  const key = ((event.queryStringParameters && event.queryStringParameters.key) || '').trim();
  if (!SUPABASE_URL || !SR) return page(gate('Not connected', 'The investor room isn’t configured yet.'));
  if (!key) return page(gate('Private link required', 'This page is available by invitation only. Please use the access link Atterra sent you.'));

  let row = null;
  try {
    const r = await fetch(
      SUPABASE_URL + '/rest/v1/investor_links?token=eq.' + encodeURIComponent(key) + '&active=eq.true&select=id,name,view_count',
      { headers: { apikey: SR, Authorization: 'Bearer ' + SR } }
    );
    const rows = r.ok ? await r.json() : [];
    row = rows[0] || null;
  } catch (_) {}

  if (!row) return page(gate('Link invalid or revoked', 'This access link is no longer valid. Please contact Atterra Builders for a current link.'));

  // best-effort view log
  try {
    await fetch(SUPABASE_URL + '/rest/v1/investor_links?id=eq.' + row.id, {
      method: 'PATCH',
      headers: { apikey: SR, Authorization: 'Bearer ' + SR, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ view_count: (row.view_count || 0) + 1, last_viewed_at: new Date().toISOString() })
    });
  } catch (_) {}

  return page(deck(row.name || ''));
};

/* ---------------- shared styles ---------------- */
const STYLE = `
  :root{--paper:#F7F6F3;--paper2:#fff;--sand:#EFEEEB;--ink:#161616;--muted:#6E6C67;--gold:#8C8A85;--hair:#E6E5E1;
    --fd:'Bodoni Moda',Georgia,serif;--fe:'Cormorant Garamond',Georgia,serif;--fu:'Inter',system-ui,sans-serif;--g:clamp(1.25rem,5vw,6rem);}
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:var(--paper);color:var(--ink);font-family:var(--fu);font-weight:400;line-height:1.7;-webkit-font-smoothing:antialiased}
  .wrap{max-width:1180px;margin:0 auto;padding:0 var(--g)}
  section{padding:clamp(3.5rem,8vh,7rem) 0;border-top:1px solid var(--hair)}
  .eyebrow{font-size:.68rem;font-weight:500;letter-spacing:.28em;text-transform:uppercase;color:var(--gold)}
  h2{font-family:var(--fd);font-weight:500;font-size:clamp(1.8rem,4vw,3rem);line-height:1.05;letter-spacing:-.01em;margin:.8rem 0 0}
  h3{font-family:var(--fd);font-weight:500;font-size:1.35rem}
  p{color:var(--muted);font-weight:300}
  .lead{font-size:clamp(1.1rem,2vw,1.35rem);max-width:60ch;margin-top:1.4rem;color:var(--ink);font-weight:300}
  .cols{display:grid;gap:1.6rem;margin-top:2.6rem}
  @media(min-width:760px){.c2{grid-template-columns:1fr 1fr}.c3{grid-template-columns:repeat(3,1fr)}.c4{grid-template-columns:repeat(4,1fr)}}
  .card{background:var(--paper2);border:1px solid var(--hair);padding:1.8rem}
  .card .no{font-family:var(--fd);color:var(--gold);font-size:1.05rem}
  .card h3{margin:.6rem 0 .5rem}.card p{font-size:.96rem}
  .stat .n{font-family:var(--fd);font-weight:500;font-size:clamp(2rem,4vw,2.8rem);line-height:1}
  .stat .l{font-size:.62rem;letter-spacing:.16em;text-transform:uppercase;color:var(--gold);margin-top:.5rem}
  .deal{background:var(--ink);color:var(--paper);padding:clamp(2rem,4vw,3rem)}
  .deal .eyebrow{color:rgba(250,249,245,.6)}
  .deal h2{color:var(--paper)}
  .deal .grid{display:grid;gap:1.5rem;margin-top:2rem}
  @media(min-width:700px){.deal .grid{grid-template-columns:repeat(4,1fr)}}
  .deal .n{font-family:var(--fd);font-size:clamp(1.5rem,3vw,2.1rem);line-height:1}
  .deal .l{font-size:.58rem;letter-spacing:.16em;text-transform:uppercase;color:rgba(250,249,245,.55);margin-top:.5rem}
  .deal .foot{margin-top:2rem;font-family:var(--fe);font-style:italic;font-size:1.35rem;color:var(--paper)}
  .table{width:100%;border-collapse:collapse;margin-top:2rem;font-size:.95rem}
  .table th{text-align:left;font-size:.6rem;letter-spacing:.14em;text-transform:uppercase;color:var(--gold);padding:.9rem 1rem;border-bottom:1px solid var(--hair)}
  .table td{padding:.9rem 1rem;border-bottom:1px solid var(--hair)}
  .table td.n{font-family:var(--fd)}
  .scen{display:grid;gap:1.4rem;margin-top:2.4rem}
  @media(min-width:760px){.scen{grid-template-columns:repeat(3,1fr)}}
  .scen .box{background:var(--paper2);border:1px solid var(--hair);padding:1.7rem}
  .scen .box.hi{background:var(--ink);color:var(--paper)}
  .scen .tag{font-size:.6rem;letter-spacing:.16em;text-transform:uppercase;color:var(--gold)}
  .scen .psf{font-family:var(--fd);font-size:2rem;margin:.4rem 0 .1rem}
  .scen .sf{font-size:.8rem;color:var(--muted)}
  .scen.box.hi .sf,.scen .box.hi .row span:first-child{color:rgba(250,249,245,.7)}
  .scen .row{display:flex;justify-content:space-between;gap:1rem;padding:.55rem 0;border-top:1px solid var(--hair);font-size:.92rem;margin-top:.9rem}
  .scen .ret{font-family:var(--fd);font-size:1.9rem;margin-top:1rem}
  .steps{margin-top:2rem}
  .step{display:grid;grid-template-columns:auto 1fr auto;gap:1.5rem;align-items:baseline;padding:1.1rem 0;border-top:1px solid var(--hair)}
  .step .k{font-family:var(--fd);color:var(--gold)}
  .step .w{font-size:.7rem;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
  .disc{font-size:.82rem;color:var(--muted);max-width:75ch}
  .cta{background:var(--ink);color:var(--paper);text-align:center}
  .cta h2{color:var(--paper)}.cta p{color:rgba(250,249,245,.7)}
  .badge{display:inline-block;font-size:.6rem;font-weight:600;letter-spacing:.2em;text-transform:uppercase;background:var(--gold);color:#fff;padding:.4em 1em;margin-bottom:1rem}
  .foothint{font-size:.78rem;color:var(--muted);margin-top:1.2rem}
`;

function gate(title, sub) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow"><title>Atterra Builders — Private</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:wght@500&family=Inter:wght@300;400;500&display=swap" rel="stylesheet">
  <style>${STYLE} body{display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center}</style></head>
  <body><div class="wrap"><div class="eyebrow">Atterra Builders · Confidential</div>
  <h2 style="margin-top:1rem">${esc(title)}</h2><p class="lead" style="margin-left:auto;margin-right:auto">${esc(sub)}</p>
  <p class="foothint">jojo@elitelivingrealty.com · 214 · 725 · 3348</p></div></body></html>`;
}

function esc(s){return String(s==null?'':s).replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));}

function deck(name) {
  const hello = name ? `Prepared for ${esc(name)} · ` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Atterra Builders — Private Investment Opportunity</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,wght@0,400;0,500;1,400&family=Cormorant+Garamond:ital@1&family=Inter:wght@300;400;500&display=swap" rel="stylesheet">
<style>${STYLE}</style></head><body>

<section style="border-top:0;text-align:center;padding-top:clamp(4rem,10vh,8rem)">
  <div class="wrap">
    <div class="eyebrow">${hello}Private Investment Opportunity</div>
    <h1 style="font-family:var(--fd);font-weight:500;font-size:clamp(3rem,9vw,7rem);line-height:.95;letter-spacing:.06em;margin:1.2rem 0">ATTERRA</h1>
    <div class="eyebrow" style="color:var(--muted)">Builders · North Dallas</div>
    <p class="lead" style="margin:2rem auto 0;font-family:var(--fe);font-style:italic;font-size:clamp(1.3rem,2.4vw,1.9rem)">Luxury new construction, engineered by data — delivered by craft.</p>
    <p class="foothint">Build · Sell · Return · 2026 · Confidential</p>
  </div>
</section>

<section><div class="wrap"><div class="eyebrow">The Vision</div>
  <h2>We build the homes North Dallas <em>wants</em> — because we already know exactly what that is.</h2>
  <p class="lead">Atterra is a builder with a sales floor’s instincts and an analyst’s data. We’re on the ground every weekend in the exact neighborhoods we build — hosting open houses, reading buyers, and tracking every finished sale by the foot. We buy on a basis the data supports, build a luxury home in 6–8 months, and sell it in-house.</p>
</div></section>

<section class="sand" style="background:var(--sand)"><div class="wrap"><div class="eyebrow">The Opportunity</div>
  <h2>A market we measure.</h2>
  <p class="lead">North Dallas luxury new construction, priced by the foot. We track ~298 homes live across our four core areas — the spread between land basis and finished value is the opportunity.</p>
  <div class="cols c3">
    <div class="card stat"><div class="n">298</div><div class="l">Homes tracked, live</div></div>
    <div class="card stat"><div class="n">$2.3M+</div><div class="l">Representative finished value</div></div>
    <div class="card stat"><div class="n">$417/SF</div><div class="l">Our proven sale price (Whitehall)</div></div>
  </div>
</div></section>

<section><div class="wrap"><div class="eyebrow">The Model</div><h2>Acquire. Build. Sell.</h2>
  <div class="cols c3">
    <div class="card"><div class="no">01</div><h3>Acquire</h3><p>We source and buy each property — held in its own trust for protection — at a basis the data supports.</p></div>
    <div class="card"><div class="no">02</div><h3>Build</h3><p>Our GC, trades, and design team execute a 6–8 month luxury build, managed daily by a dedicated PM.</p></div>
    <div class="card"><div class="no">03</div><h3>Sell</h3><p>We list and sell in-house, leveraging our weekend market presence and buyer network — and return capital.</p></div>
  </div>
  <p class="foothint">Silent capital funds the project; investors are repaid first, then share in the proceeds.</p>
</div></section>

<section class="sand" style="background:var(--sand)"><div class="wrap"><div class="eyebrow">Our Edge</div><h2>What we have that others don’t.</h2>
  <div class="cols c3">
    <div class="card"><div class="no">01</div><h3>Boots on the ground</h3><p>Open houses every weekend in these neighborhoods — we know what today’s buyer wants, and will pay.</p></div>
    <div class="card"><div class="no">02</div><h3>Proprietary intelligence</h3><p>Area Intel tracks ~298 homes: $/SF by area, builder pricing, school premiums. We price by fact, not feel.</p></div>
    <div class="card"><div class="no">03</div><h3>A command-center app</h3><p>A custom platform runs every build — tasks, costs, orders, documents, daily logs — with AI and voice.</p></div>
    <div class="card"><div class="no">04</div><h3>The trades, locked</h3><p>A GC and trade roster proven at the $1.7M–$3.5M price point, with vendor accounts and sourcing in place.</p></div>
    <div class="card"><div class="no">05</div><h3>The design bench</h3><p>Architects we’ve built with — plus a deeper bench for any style vision the lot calls for.</p></div>
    <div class="card"><div class="no">06</div><h3>In-house sales</h3><p>We don’t list and wait. We sell — with a buyer database and a sales director on every deal.</p></div>
  </div>
</div></section>

<section><div class="wrap"><div class="eyebrow">The Team</div><h2>Operators, not spectators.</h2>
  <div class="cols c3">
    <div class="card"><h3>Pamela Tellez</h3><div class="eyebrow" style="color:var(--gold);margin:.4rem 0">Project Manager</div><p>Proven luxury-build manager — runs the GC day-to-day.</p></div>
    <div class="card"><h3>Cliff Graham</h3><div class="eyebrow" style="color:var(--gold);margin:.4rem 0">Designer</div><p>Leads design and selections — the finishes buyers pay up for.</p></div>
    <div class="card"><h3>JoJo Garcia</h3><div class="eyebrow" style="color:var(--gold);margin:.4rem 0">Sales Director</div><p>On the ground every weekend — drives positioning and the sale.</p></div>
  </div>
</div></section>

<section class="sand" style="background:var(--sand)"><div class="wrap"><div class="eyebrow">Track Record</div><h2>Already building. Already selling.</h2>
  <div class="cols c3">
    <div class="card stat"><div class="n">3</div><div class="l">Homes completed</div></div>
    <div class="card stat"><div class="n">9</div><div class="l">In the active pipeline</div></div>
    <div class="card stat"><div class="n">$1.7–3.5M</div><div class="l">Price point we build in</div></div>
  </div>
</div></section>

<section><div class="wrap">
  <div class="deal">
    <span class="badge">Under Contract</span>
    <div class="eyebrow">Flagship Deal · Recorded</div>
    <h2>3239 Whitehall Drive</h2>
    <p style="color:rgba(250,249,245,.75);margin-top:1rem;max-width:60ch">Real and under contract — a 5-suite, single-story modern in North Dallas (4,375 SF), priced at the top of the market.</p>
    <div class="grid">
      <div><div class="n">$470K</div><div class="l">Acquisition · Mar 2025</div></div>
      <div><div class="n">≈ $1.6M</div><div class="l">All-in · est.</div></div>
      <div><div class="n">$1.825M</div><div class="l">Under contract</div></div>
      <div><div class="n">$417/SF</div><div class="l">Highest in 75229</div></div>
    </div>
    <div class="foot">≈ $225,000 gross spread — under contract at $417/SF, the highest in the neighborhood.</div>
  </div>
  <div class="cols c2" style="margin-top:2rem">
    <div class="card"><div class="eyebrow" style="color:var(--gold)">The financing · recorded</div>
      <p style="margin-top:1rem;color:var(--ink)">Loan Ranger Capital funded a <strong>$1,143,250</strong> loan — including an <strong>$875,000</strong> construction escrow. Land closed Mar 20, 2025; the build draws from escrow as work completes.</p></div>
    <div class="card"><div class="eyebrow" style="color:var(--gold)">The equity</div>
      <p style="margin-top:1rem;color:var(--ink)">Cash to close <strong>$231,576</strong> — the equity position at acquisition. Origination $34,298 (3.0 pts) on a construction loan against a 6–8 month build.</p></div>
  </div>
  <p class="foothint">Purchase figures from the recorded settlement statement (3/20/2025). Build cost owner-estimated; sale under contract.</p>
</div></section>

<section class="sand" style="background:var(--sand)"><div class="wrap">
  <div class="deal">
    <span class="badge">Active Build</span>
    <div class="eyebrow">Acquired Jun 2026</div>
    <h2>3316 Townsend Drive</h2>
    <p style="color:rgba(250,249,245,.75);margin-top:1rem;max-width:60ch">The next build — acquired and financed. A 5,500 SF transitional modern, priced off Whitehall’s proven $/SF.</p>
    <div class="grid">
      <div><div class="n">$535K</div><div class="l">Acquisition · Jun 2026</div></div>
      <div><div class="n">$1.07M</div><div class="l">Build budget</div></div>
      <div><div class="n">≈ $1.77M</div><div class="l">All-in cost</div></div>
      <div><div class="n">$2.37M</div><div class="l">Target · $430/SF</div></div>
    </div>
    <div class="foot">≈ $595,000 target gross spread — 5,500 SF at $430/SF, proven by Whitehall.</div>
  </div>
  <p class="foothint">Acquisition &amp; loan from the recorded settlement statement (6/24/2026); build from the project budget. Target value at $430/SF × 5,500 SF.</p>
</div></section>

<section><div class="wrap"><div class="eyebrow">Comparable Sales</div><h2>The value is on the comps.</h2>
  <p class="lead">Recent finished sales in 75229 — five-bedroom new construction. Whitehall at $417/SF sits at the top; Townsend’s $430/SF target is the size premium.</p>
  <table class="table"><thead><tr><th>Address</th><th>Sold</th><th>$/SF</th><th>Beds/Baths</th><th>SF</th></tr></thead><tbody>
    <tr><td>3179 Jubilee Trail</td><td class="n">$1,800,000</td><td class="n">$372</td><td>5 / 4.5</td><td>4,837</td></tr>
    <tr><td>3341 Dothan Lane</td><td class="n">$1,820,000</td><td class="n">$404</td><td>5 / 5</td><td>4,509</td></tr>
    <tr><td>3252 Jubilee Trail</td><td class="n">$1,899,000</td><td class="n">$372</td><td>5 / 5</td><td>5,110</td></tr>
    <tr><td><strong>3239 Whitehall (ours)</strong></td><td class="n">$1,825,000</td><td class="n"><strong>$417</strong></td><td>5 / 5.5</td><td>4,375</td></tr>
  </tbody></table>
</div></section>

<section class="sand" style="background:var(--sand)"><div class="wrap"><div class="eyebrow">The Investment</div><h2>How you participate.</h2>
  <div class="cols c3">
    <div class="card"><div class="no">01</div><h3>Atterra builds</h3><p>Atterra executes — sourcing, construction, and sale, end to end.</p></div>
    <div class="card"><div class="no">02</div><h3>Held in trust</h3><p>Each property is held in its own trust, for asset protection and clean separation.</p></div>
    <div class="card"><div class="no">03</div><h3>Silent capital</h3><p>You fund the project capital; we do the work. No operational burden on you.</p></div>
    <div class="card"><div class="no">04</div><h3>Repaid first</h3><p>Your principal is returned first — before any profit is split.</p></div>
    <div class="card"><div class="no">05</div><h3>Then an equal share</h3><p>After payback, profit is split four ways — the three principals and you — 25% each.</p></div>
    <div class="card"><div class="no">06</div><h3>Fully tracked</h3><p>Every dollar is tracked live in our build system — a running cost ledger per project.</p></div>
  </div>
</div></section>

<section><div class="wrap"><div class="eyebrow">Investor Returns · Illustrative</div><h2>What you put in — and what comes back.</h2>
  <table class="table" style="max-width:640px"><tbody>
    <tr><td>Your capital in (incl. reserve)</td><td class="n" style="text-align:right">≈ $190,000</td></tr>
    <tr><td>Net profit · after sale costs</td><td class="n" style="text-align:right">≈ $500,000</td></tr>
    <tr><td>Your principal — returned first</td><td class="n" style="text-align:right">$190,000</td></tr>
    <tr><td>Your profit share — 25% (1 of 4)</td><td class="n" style="text-align:right">≈ $125,000</td></tr>
    <tr><td><strong>Total back to you</strong></td><td class="n" style="text-align:right"><strong>≈ $315,000</strong></td></tr>
  </tbody></table>
  <p class="lead" style="margin-top:1.6rem">≈ <strong>$315,000 total back on ≈ $190,000 in</strong> — about a 1.65× return, ≈ 66% on capital, over a 6–8 month build. Based on Townsend’s target sale at $430/SF, net of ~$95K sale costs. Capital carries a reserve cushion and is at risk — see Risk &amp; Mitigation.</p>
</div></section>

<section class="sand" style="background:var(--sand)"><div class="wrap"><div class="eyebrow">Investor Returns · Scenarios</div><h2>Size and price both pay you.</h2>
  <div class="scen">
    <div class="box"><div class="tag">Market size · est.</div><div class="psf">$417/SF</div><div class="sf">4,400 SF home</div>
      <div class="row"><span>Sale price</span><span>≈ $1.83M</span></div><div class="row"><span>Net profit</span><span>≈ $200K</span></div>
      <div class="row"><span>Your 25% share</span><span>≈ $50K</span></div><div class="ret">≈ 28%</div><div class="sf">Return on ~$180K · ~8 mo</div></div>
    <div class="box"><div class="tag">Our build · proven price</div><div class="psf">$417/SF</div><div class="sf">5,500 SF home</div>
      <div class="row"><span>Sale price</span><span>≈ $2.29M</span></div><div class="row"><span>Net profit</span><span>≈ $430K</span></div>
      <div class="row"><span>Your 25% share</span><span>≈ $108K</span></div><div class="ret">≈ 57%</div><div class="sf">Return on ~$190K · ~8 mo</div></div>
    <div class="box hi"><div class="tag" style="color:var(--gold)">Our build · target</div><div class="psf">$430/SF</div><div class="sf" style="color:rgba(250,249,245,.7)">5,500 SF home</div>
      <div class="row" style="border-color:rgba(250,249,245,.2)"><span style="color:rgba(250,249,245,.7)">Sale price</span><span>≈ $2.37M</span></div>
      <div class="row" style="border-color:rgba(250,249,245,.2)"><span style="color:rgba(250,249,245,.7)">Net profit</span><span>≈ $500K</span></div>
      <div class="row" style="border-color:rgba(250,249,245,.2)"><span style="color:rgba(250,249,245,.7)">Your 25% share</span><span>≈ $125K</span></div>
      <div class="ret">≈ 66%</div><div class="sf" style="color:rgba(250,249,245,.7)">Return on ~$190K · ~8 mo</div></div>
  </div>
  <p class="foothint">Same lot, same system — home size and price both drive the return. Land is a fixed cost, so building the larger 5,500 SF home spreads it over more sellable feet. Even a market-size 4,400 SF home at the proven $417/SF returns ~28%. (4,400 SF cost estimated from Townsend’s per-foot budget.)</p>
</div></section>

<section><div class="wrap"><div class="eyebrow">Use of Funds &amp; Timeline</div><h2>Where capital goes — and when it returns.</h2>
  <div class="cols c2">
    <div>
      <table class="table"><tbody>
        <tr><td>Cash to close · down payment + fees</td><td class="n" style="text-align:right">≈ $165K</td></tr>
        <tr><td>Working capital &amp; carry reserve</td><td style="text-align:right">buffer</td></tr>
        <tr><td>Contingency</td><td style="text-align:right">5%+</td></tr>
        <tr><td>Soft costs · survey, insurance, design</td><td style="text-align:right">as needed</td></tr>
      </tbody></table>
    </div>
    <div class="steps">
      <div class="step"><span class="k">01</span><span>Acquire &amp; permit</span><span class="w">Month 0</span></div>
      <div class="step"><span class="k">02</span><span>Build</span><span class="w">Months 1–6</span></div>
      <div class="step"><span class="k">03</span><span>List &amp; sell</span><span class="w">Months 6–8</span></div>
      <div class="step"><span class="k">04</span><span>Return capital</span><span class="w">On close</span></div>
    </div>
  </div>
  <p class="foothint">A 6–8 month build against an 18-month loan term leaves a deliberate cushion.</p>
</div></section>

<section class="sand" style="background:var(--sand)"><div class="wrap"><div class="eyebrow">Risk &amp; Mitigation</div><h2>We name the risks — and manage them.</h2>
  <div class="cols c2">
    <div class="card"><h3>Market softening</h3><p>Conservative, data-backed values from Area Intel; we buy on a basis the comps support. Our conservative case prices at the proven $417/SF, not the $430 target.</p></div>
    <div class="card"><h3>Cost overruns</h3><p>Trade pricing locked at this price point; 5%+ contingency; daily PM cost control in-app with a live ledger.</p></div>
    <div class="card"><h3>Timeline slippage</h3><p>6–8 month build against an 18-month loan — a wide buffer, with weekly oversight.</p></div>
    <div class="card"><h3>Leverage / first-loss</h3><p>Your capital sits in the equity position behind the construction loan. That’s why the return is high — and why we buy conservatively and price to comps.</p></div>
  </div>
</div></section>

<section class="cta"><div class="wrap" style="text-align:center">
  <div class="eyebrow" style="color:rgba(250,249,245,.6)">The Invitation</div>
  <h2 style="margin-top:1rem">Build with us.</h2>
  <p class="lead" style="margin:1.4rem auto 2rem;color:rgba(250,249,245,.8)">We have the market, the team, the trades, and the system. We’re inviting a select group of investors to fund the next homes — and share in what they become.</p>
  <div style="font-family:var(--fd);font-size:1.3rem">JoJo Garcia</div>
  <div class="eyebrow" style="color:rgba(250,249,245,.6);margin-top:.4rem">Sales Director · Atterra Builders</div>
  <p style="color:var(--paper);margin-top:1rem">jojo@elitelivingrealty.com · 214 · 725 · 3348</p>
</div></section>

<section><div class="wrap"><div class="eyebrow">Important Disclosures</div>
  <h3 style="margin:.8rem 0 1rem">Confidential — for discussion purposes only.</h3>
  <p class="disc">This presentation is confidential and provided solely for informational and discussion purposes. It does not constitute an offer to sell, or a solicitation of an offer to buy, any security or investment. All figures are estimates or targets and are subject to change; certain figures (build costs, target sale prices, and returns) are illustrative and not guaranteed. Past or in-progress projects are not indicative of future results. Real estate investment involves substantial risk, including the possible loss of principal. Certain projects referenced were acquired and financed by affiliated entities (JLJ Capital Partners LLC; Build DallasTX LLC) with Atterra participating in design, pricing, and sale. Prospective investors should conduct their own due diligence and consult their own legal, tax, and financial advisors. Nothing herein is legal, tax, or investment advice.</p>
</div></section>

</body></html>`;
}
