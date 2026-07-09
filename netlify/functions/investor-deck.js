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
    --fd:'Bodoni Moda',Georgia,serif;--fe:'Cormorant Garamond',Georgia,serif;--fu:'Inter',system-ui,sans-serif;--g:clamp(1.25rem,5vw,6rem);
    --hero-img:url('/assets/hero.jpg');--band-img:url('/assets/service-development.jpg');}
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

  /* ---- editorial hero + motion ---- */
  .hero{position:relative;min-height:100svh;display:flex;align-items:center;justify-content:center;
    text-align:center;color:#fff;overflow:hidden;isolation:isolate;border-top:0;padding:2rem var(--g)}
  .hero .bg{position:absolute;inset:0;z-index:-2;background:#151515 center/cover no-repeat;
    background-image:var(--hero-img);animation:kb 30s ease-in-out infinite alternate;
    transform-origin:58% 42%;will-change:transform}
  .hero::after{content:"";position:absolute;inset:0;z-index:-1;background:linear-gradient(180deg,
    rgba(12,12,12,.58) 0%,rgba(12,12,12,.22) 34%,rgba(12,12,12,.30) 60%,rgba(10,10,10,.74) 100%)}
  @keyframes kb{from{transform:scale(1.05)}to{transform:scale(1.17)}}
  .hero .inner{max-width:62rem;animation:fadeUp 1.4s cubic-bezier(.16,1,.3,1) .12s both}
  .hero .eyebrow{color:rgba(255,255,255,.82)}
  .hero h1{font-family:var(--fd);font-weight:500;font-size:clamp(3.4rem,12vw,9rem);line-height:.9;
    letter-spacing:.08em;text-indent:.08em;color:#fff;margin:1.3rem 0 .3rem;text-shadow:0 2px 60px rgba(0,0,0,.5)}
  .hero .kick{font-size:.66rem;font-weight:500;letter-spacing:.5em;text-indent:.5em;text-transform:uppercase;color:rgba(255,255,255,.8)}
  .hero .sub{font-family:var(--fe);font-style:italic;font-size:clamp(1.35rem,2.7vw,2.2rem);
    color:rgba(255,255,255,.94);margin-top:1.8rem;line-height:1.35}
  .hero .cue{position:absolute;bottom:1.7rem;left:50%;transform:translateX(-50%);
    font-size:.58rem;letter-spacing:.36em;text-transform:uppercase;color:rgba(255,255,255,.7)}
  @keyframes fadeUp{from{opacity:0;transform:translateY(28px)}to{opacity:1;transform:none}}

  /* full-bleed editorial band */
  .band{position:relative;min-height:56svh;display:flex;align-items:center;justify-content:center;
    text-align:center;color:#fff;overflow:hidden;border-top:0}
  .band .bg{position:absolute;inset:0;z-index:-2;background:#151515 center/cover no-repeat;
    background-image:var(--band-img);animation:kb 34s ease-in-out infinite alternate;transform-origin:40% 50%}
  .band::after{content:"";position:absolute;inset:0;z-index:-1;background:rgba(12,12,12,.5)}
  .band .q{font-family:var(--fe);font-style:italic;font-weight:500;font-size:clamp(1.7rem,4vw,3rem);
    color:#fff;max-width:22ch;text-shadow:0 2px 40px rgba(0,0,0,.5)}

  /* reveal on scroll */
  .reveal{opacity:0;transform:translateY(22px);transition:opacity 1s cubic-bezier(.2,.7,.2,1),transform 1s cubic-bezier(.2,.7,.2,1)}
  .reveal.in{opacity:1;transform:none}
  @media(prefers-reduced-motion:reduce){
    .hero .bg,.band .bg,.hero .inner{animation:none!important}
    .reveal{opacity:1!important;transform:none!important}}
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

<section class="hero">
  <div class="bg" aria-hidden="true"></div>
  <div class="inner">
    <div class="eyebrow">${hello}Private Investment Opportunity</div>
    <h1>ATTERRA</h1>
    <div class="kick">Builders · North Dallas</div>
    <p class="sub">Luxury new construction,<br>engineered by data — delivered by craft.</p>
  </div>
  <span class="cue">Scroll</span>
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
      <div><div class="n">$507K</div><div class="l">Acquisition · Jun 2026</div></div>
      <div><div class="n">$1.07M</div><div class="l">Build budget</div></div>
      <div><div class="n">≈ $1.64M</div><div class="l">All-in incl. carry</div></div>
      <div><div class="n">$2.31M</div><div class="l">Target · $420/SF</div></div>
    </div>
    <div class="foot">≈ $672,000 gross / ≈ $556,000 net at $420/SF — after carrying and sale costs.</div>
  </div>
  <p class="foothint">Acquisition from the recorded settlement statement (6/24/2026): $500,000 purchase price, $507K all-in. Build from the project budget ($1,067,325, incl. 5% contingency). All-in adds ~6% carrying; target value at $420/SF × 5,500 SF, net of ~5% sale costs — with the listing side captured in-house.</p>
</div></section>

<section><div class="wrap"><div class="eyebrow">Comparable Sales</div><h2>The value is on the comps.</h2>
  <p class="lead">Recent finished sales in 75229 — five-bedroom new construction, from the July 2026 market analysis. Whitehall at $417/SF sits at the top; Townsend’s $420/SF target is the size premium.</p>
  <table class="table"><thead><tr><th>Address</th><th>Price</th><th>$/SF</th><th>SF</th><th>Status</th></tr></thead><tbody>
    <tr><td>3629 Vancouver Dr</td><td class="n">$1,785,000</td><td class="n">$387</td><td>4,609</td><td>Closed</td></tr>
    <tr><td>3207 Latham Dr</td><td class="n">$1,800,000</td><td class="n">$369</td><td>4,876</td><td>Closed</td></tr>
    <tr><td>10917 Beauty Ln</td><td class="n">$1,816,000</td><td class="n">$397</td><td>4,573</td><td>Closed</td></tr>
    <tr><td>3252 Jubilee Trail</td><td class="n">$1,899,000</td><td class="n">$372</td><td>5,110</td><td>Closed</td></tr>
    <tr><td><strong>3239 Whitehall (ours)</strong></td><td class="n">$1,825,000</td><td class="n"><strong>$417</strong></td><td>4,375</td><td>Under contract</td></tr>
  </tbody></table>
</div></section>

<section><div class="wrap"><div class="eyebrow">Market Geography · The Marsh Line</div>
  <h2>We know exactly where value lives — down to the street.</h2>
  <p class="lead">Our core pocket — Northaven to Royal, Webb Chapel to Marsh — trades around <strong>$377/SF</strong>. One street east, across Marsh Lane, the same square footage sells for <strong>$541/SF</strong>. Knowing precisely where that line sits — and buying right up against it — is the edge.</p>
  <div style="margin-top:2.2rem;border:1px solid var(--hair);background:var(--paper2);padding:clamp(.6rem,2vw,1.4rem);overflow-x:auto">
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1160 640" style="width:100%;height:auto;display:block;min-width:640px" font-family="Inter, system-ui, sans-serif">
  <rect x="0" y="0" width="1160" height="640" fill="#F7F6F3"/>
  <g stroke="#E1E0DC" stroke-width="1">
    <line x1="120" y1="150" x2="1040" y2="150"/><line x1="120" y1="215" x2="1040" y2="215"/>
    <line x1="120" y1="285" x2="1040" y2="285"/><line x1="120" y1="355" x2="1040" y2="355"/>
    <line x1="120" y1="425" x2="1040" y2="425"/><line x1="120" y1="495" x2="1040" y2="495"/>
    <line x1="210" y1="120" x2="210" y2="520"/><line x1="330" y1="120" x2="330" y2="520"/>
    <line x1="450" y1="120" x2="450" y2="520"/><line x1="570" y1="120" x2="570" y2="520"/>
    <line x1="850" y1="120" x2="850" y2="520"/><line x1="960" y1="120" x2="960" y2="520"/>
  </g>
  <polygon points="210,150 700,150 700,495 210,495" fill="#161616" fill-opacity="0.055" stroke="#8C8A85" stroke-width="1.5" stroke-dasharray="6 5"/>
  <line x1="700" y1="95" x2="700" y2="545" stroke="#161616" stroke-width="4"/>
  <text x="700" y="80" text-anchor="middle" fill="#161616" font-size="19" font-weight="600" letter-spacing="3">MARSH LANE</text>
  <text x="700" y="565" text-anchor="middle" fill="#8C8A85" font-size="13" letter-spacing="2">THE PRICE LINE</text>
  <text x="215" y="140" fill="#6E6C67" font-size="12.5" letter-spacing="1">Northaven Rd</text>
  <text x="215" y="514" fill="#6E6C67" font-size="12.5" letter-spacing="1">Royal Ln</text>
  <text x="132" y="315" fill="#6E6C67" font-size="12.5" letter-spacing="1" transform="rotate(-90 132 315)">Webb Chapel Rd</text>
  <text x="250" y="185" fill="#161616" font-size="17" font-weight="600" letter-spacing="2">ATTERRA CORE POCKET</text>
  <text x="250" y="207" fill="#8C8A85" font-size="12.5" letter-spacing="1">75229 · new-construction average ≈ $377/SF</text>
  <g font-size="12.5" fill="#161616">
    <circle cx="290" cy="320" r="7" fill="#161616"/><text x="304" y="324">3316 Townsend · 5,500 SF · active build</text>
    <circle cx="290" cy="250" r="7" fill="#161616"/><text x="304" y="254">3239 Whitehall · $417/SF · under contract</text>
    <circle cx="290" cy="390" r="7" fill="#161616"/><text x="304" y="394">3229 Jubilee · $420/SF · coming soon</text>
  </g>
  <circle cx="820" cy="360" r="9" fill="#B23A2E"/>
  <circle cx="820" cy="360" r="17" fill="none" stroke="#B23A2E" stroke-width="2"/>
  <text x="845" y="356" fill="#161616" font-size="13.5" font-weight="600">3787 Vinecrest</text>
  <text x="845" y="375" fill="#6E6C67" font-size="12.5">5,342 SF · listed $2.89M · $541/SF</text>
  <text x="455" y="452" text-anchor="middle" fill="#161616" font-size="22" font-weight="600" font-family="'Bodoni Moda', Georgia, serif">$377/SF</text>
  <line x1="530" y1="446" x2="770" y2="446" stroke="#B23A2E" stroke-width="2"/>
  <polygon points="770,446 758,440 758,452" fill="#B23A2E"/>
  <text x="820" y="452" text-anchor="middle" fill="#B23A2E" font-size="22" font-weight="600" font-family="'Bodoni Moda', Georgia, serif">$541/SF</text>
  <text x="650" y="432" text-anchor="middle" fill="#8C8A85" font-size="12" letter-spacing="1">cross Marsh</text>
  <text x="580" y="605" text-anchor="middle" fill="#6E6C67" font-size="13.5">One street across Marsh, price jumps <tspan font-weight="600" fill="#161616">+$164/SF</tspan> — roughly <tspan font-weight="600" fill="#161616">$870K</tspan> on a 5,300 SF home.</text>
  </svg>
  </div>
  <div class="cols c3" style="margin-top:2rem">
    <div class="card stat"><div class="n">$377/SF</div><div class="l">Core pocket · new-construction avg</div></div>
    <div class="card stat"><div class="n">$541/SF</div><div class="l">Across Marsh · 3787 Vinecrest</div></div>
    <div class="card stat"><div class="n">+$164/SF</div><div class="l">The Marsh premium · ≈ $870K / home</div></div>
  </div>
  <p class="foothint">3787 Vinecrest — 5,342 SF, listed at $2.89M ($541/SF) — sits just across Marsh. We don’t underwrite that premium into our deals; we simply have our hand on the pulse of exactly where it begins. $/SF figures from the July 2026 market analysis.</p>
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
    <tr><td>Net profit · after carrying &amp; sale costs</td><td class="n" style="text-align:right">≈ $450,000</td></tr>
    <tr><td>Your principal — returned first</td><td class="n" style="text-align:right">$190,000</td></tr>
    <tr><td>Your profit share — 25% (1 of 4)</td><td class="n" style="text-align:right">≈ $113,000</td></tr>
    <tr><td><strong>Total back to you</strong></td><td class="n" style="text-align:right"><strong>≈ $303,000</strong></td></tr>
  </tbody></table>
  <p class="lead" style="margin-top:1.6rem">≈ <strong>$303,000 total back on ≈ $190,000 in</strong> — about a 1.6× return, ≈ 59% on capital, over a 6–8 month build. Modeled conservatively on Townsend at $400/SF — the proven market max, below our $420 target — net of carrying and sale costs. Capital carries a reserve cushion and is at risk — see Risk &amp; Mitigation.</p>
</div></section>

<section class="sand" style="background:var(--sand)"><div class="wrap"><div class="eyebrow">Development Pro Forma · By Size &amp; Price</div>
  <h2>Every size, every price — it pays.</h2>
  <p class="lead">One cost model, built from real numbers and underwritten conservatively: land at our Townsend basis of <strong>$507K</strong>, construction at <strong>$194/SF</strong> (the actual Townsend budget), <strong>carrying at ~6%</strong> of build (interest, taxes, insurance, utilities over the 6–8 month hold), and <strong>sale costs at 5%</strong>. <em>Net profit</em> is project-level after every cost; <em>Your 25%</em> is the investor’s profit share after principal is returned.</p>

  <div class="cols c2" style="margin-top:2.4rem">
    <div class="card">
      <h3>4,300 SF home</h3>
      <div class="eyebrow" style="color:var(--gold);margin:.55rem 0 0">All-in ≈ $1.39M · land $507K + build $834K + carry $50K</div>
      <table class="table" style="margin-top:1.1rem">
        <thead><tr><th>Reality</th><th>$/SF</th><th>Sale</th><th>Net profit</th><th>Your 25%</th></tr></thead>
        <tbody>
          <tr><td>Current market</td><td class="n">$378</td><td class="n">$1.63M</td><td class="n">$153K</td><td class="n">$38K</td></tr>
          <tr><td>Market max</td><td class="n">$400</td><td class="n">$1.72M</td><td class="n">$243K</td><td class="n">$61K</td></tr>
          <tr><td><strong>Aterra target</strong></td><td class="n"><strong>$420</strong></td><td class="n">$1.81M</td><td class="n"><strong>$324K</strong></td><td class="n"><strong>$81K</strong></td></tr>
        </tbody>
      </table>
    </div>
    <div class="card">
      <h3>5,200 SF home</h3>
      <div class="eyebrow" style="color:var(--gold);margin:.55rem 0 0">All-in ≈ $1.58M · land $507K + build $1.01M + carry $61K</div>
      <table class="table" style="margin-top:1.1rem">
        <thead><tr><th>Reality</th><th>$/SF</th><th>Sale</th><th>Net profit</th><th>Your 25%</th></tr></thead>
        <tbody>
          <tr><td>Current market</td><td class="n">$378</td><td class="n">$1.97M</td><td class="n">$291K</td><td class="n">$73K</td></tr>
          <tr><td>Market max</td><td class="n">$400</td><td class="n">$2.08M</td><td class="n">$400K</td><td class="n">$100K</td></tr>
          <tr><td><strong>Aterra target</strong></td><td class="n"><strong>$420</strong></td><td class="n">$2.18M</td><td class="n"><strong>$498K</strong></td><td class="n"><strong>$125K</strong></td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <div class="deal" style="margin-top:1.8rem">
    <div class="eyebrow">Stress Test · build runs 30% over</div>
    <h2 style="font-size:clamp(1.4rem,3vw,2rem)">And if everything costs 30% more?</h2>
    <p style="color:rgba(250,249,245,.78);margin-top:.9rem;max-width:66ch">We pressure-test every deal against a 30% hard-cost overrun — change orders, material spikes, delays, all of it. At our target price, both homes still clear a profit. Only a simultaneous 30% blow-out <em>and</em> a fall back to today’s average price would pressure the smaller home — which is exactly why we build larger and price to the target.</p>
    <div style="display:grid;grid-template-columns:auto repeat(3,1fr);gap:.7rem 1.1rem;margin-top:1.8rem;align-items:baseline">
      <div class="l">&nbsp;</div><div class="l">@ $378 · current</div><div class="l">@ $400 · max</div><div class="l">@ $420 · target</div>
      <div class="l" style="color:var(--paper)">4,300 SF net</div><div class="n">−$112K</div><div class="n">−$23K</div><div class="n">+$59K</div>
      <div class="l" style="color:var(--paper)">5,200 SF net</div><div class="n">−$30K</div><div class="n">+$79K</div><div class="n">+$178K</div>
    </div>
    <div class="foot" style="font-size:1.05rem;margin-top:1.6rem">At target pricing, a full 30% cost overrun still nets +$59K to +$178K — the deal survives its own worst case.</div>
  </div>

  <div class="card" style="margin-top:1.6rem;border-left:3px solid var(--gold)">
    <div class="eyebrow" style="color:var(--gold)">Built-in upside · in-house listing</div>
    <p style="margin-top:.6rem;color:var(--ink)">The net figures above already deduct a full 5% for sale costs. Because Atterra lists every home in-house, the <strong>~2.5–3% listing-side commission — roughly $45K–$65K per home</strong> — is captured by the team rather than paid out. That’s margin the model doesn’t even count.</p>
  </div>

  <p class="foothint">Base case includes carrying and sale costs. Land is a fixed cost, so the larger 5,200 SF home spreads it over more sellable feet — bigger home, fatter margin. $/SF anchors: current market $378 (blended new-construction comps), market max $400 (top closed comp — 10917 Beauty at $397/SF), Atterra target $420 (3239 Whitehall under contract at $417/SF; 3229 Jubilee coming soon, target $420/SF). Construction held flat at Townsend’s $194/SF; carrying ≈ 6% of build; stress test adds 30% to all hard costs.</p>
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
    <div class="card"><h3>Market softening</h3><p>Conservative, data-backed values from Area Intel; we buy on a basis the comps support. Our conservative case prices at today’s market, not the $420 target.</p></div>
    <div class="card"><h3>Cost overruns</h3><p>Trade pricing locked at this price point; 5% contingency in every budget; daily PM cost control in-app with a live ledger. We underwrite each deal against a 30% hard-cost overrun — and it still profits at target pricing.</p></div>
    <div class="card"><h3>Timeline slippage</h3><p>6–8 month build against an 18-month loan — a wide buffer, with weekly oversight.</p></div>
    <div class="card"><h3>Leverage / first-loss</h3><p>Your capital sits in the equity position behind the construction loan. That’s why the return is high — and why we buy conservatively and price to comps.</p></div>
  </div>
</div></section>

<section class="band"><div class="bg" aria-hidden="true"></div>
  <div class="q">Built for life.<br>Designed for you.</div>
</section>

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

<script>
(function(){
  var els = document.querySelectorAll('section:not(.hero):not(.band) h2, section .lead, section .cols, section .table, section .scen, section .deal, section .steps, section .disc');
  if (!('IntersectionObserver' in window)) return;
  var io = new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target);}});},{threshold:.12,rootMargin:'0px 0px -8% 0px'});
  els.forEach(function(el){el.classList.add('reveal');io.observe(el);});
})();
</script>
</body></html>`;
}
