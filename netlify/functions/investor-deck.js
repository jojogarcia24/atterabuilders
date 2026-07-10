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
  .headshot{width:100%;aspect-ratio:1/1;object-fit:cover;object-position:50% 22%;display:block;margin:-1.8rem -1.8rem 1.2rem;width:calc(100% + 3.6rem);max-width:none;filter:grayscale(.12)}
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
  .maplegend{display:flex;flex-wrap:wrap;gap:.55rem 1.5rem;margin-top:1.1rem;padding-top:1.1rem;border-top:1px solid var(--hair);font-size:.86rem;color:var(--muted)}
  .maplegend span{display:flex;align-items:center;gap:.55rem}
  .maplegend b{display:inline-flex;align-items:center;justify-content:center;width:1.5em;height:1.5em;border-radius:50%;background:var(--ink);color:#fff;font-size:.72rem;font-weight:600;flex:none}

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
    <div class="card"><img class="headshot" src="/assets/team-pamela.jpg" alt="Pamela Tellez"><h3>Pamela Tellez</h3><div class="eyebrow" style="color:var(--gold);margin:.4rem 0">Project Manager</div><p>Proven luxury-build manager — runs the GC day-to-day.</p></div>
    <div class="card"><img class="headshot" src="/assets/team-cliff.jpg" alt="Cliff Graham"><h3>Cliff Graham</h3><div class="eyebrow" style="color:var(--gold);margin:.4rem 0">Designer</div><p>Leads design and selections — the finishes buyers pay up for.</p></div>
    <div class="card"><img class="headshot" src="/assets/team-jojo.jpg" alt="JoJo Garcia"><h3>JoJo Garcia</h3><div class="eyebrow" style="color:var(--gold);margin:.4rem 0">Sales Director</div><p>On the ground every weekend — drives positioning and the sale.</p></div>
  </div>
</div></section>

<section class="sand" style="background:var(--sand)"><div class="wrap"><div class="eyebrow">The System</div><h2>One platform runs the build.</h2>
  <p class="lead">Every build, team member, task, document, cost and order — in one place. A command center we operate, not a spreadsheet we chase.</p>
  <div class="cols c2">
    <div class="card"><div class="no">01</div><h3>AI intake</h3><p>AI reads receipts and documents, auto-sorts them, and syncs to Drive — no manual filing.</p></div>
    <div class="card"><div class="no">02</div><h3>69-step SOP</h3><p>A 69-step construction SOP routes the next task to the right person, automatically.</p></div>
    <div class="card"><div class="no">03</div><h3>Live ledger</h3><p>Live budgets, change orders, and a master ledger across every project — every dollar tracked.</p></div>
    <div class="card"><div class="no">04</div><h3>Voice + text assistant</h3><p>A voice and text assistant answers questions and updates the build hands-free, from the field.</p></div>
  </div>
</div></section>

<section><div class="wrap"><div class="eyebrow">Proprietary Intelligence</div><h2>We price by data, not by hope.</h2>
  <p class="lead">Our Area Intel tracks the market by the foot, so every buy and every list price is set on fact.</p>
  <div class="cols c3">
    <div class="card stat"><div class="n">298</div><div class="l">Homes tracked, live · four areas</div></div>
    <div class="card stat"><div class="n">By street</div><div class="l">What every block commands per foot</div></div>
    <div class="card stat"><div class="n">By school</div><div class="l">The feeder premiums buyers pay for</div></div>
  </div>
  <div class="cols c2" style="margin-top:1.6rem">
    <div class="card"><h3>By builder</h3><p>List-vs-sold gap, price-cut rate, and days on market for every builder in the pocket — we know who’s discounting and who’s holding.</p></div>
    <div class="card"><h3>By the foot</h3><p>Every finished sale tracked per square foot, by street and by size — the exact basis behind our $/SF targets.</p></div>
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
    <div class="card"><div class="eyebrow" style="color:var(--gold)">The economics · recorded</div>
      <p style="margin-top:1rem;color:var(--ink)">Land closed <strong>Mar 20, 2025</strong> at <strong>$470K</strong>; built to a luxury 4,375 SF single-story and now under contract at <strong>$1,825,000</strong> — a ≈ $225K gross spread on a 6–8 month build.</p></div>
    <div class="card"><div class="eyebrow" style="color:var(--gold)">The proof</div>
      <p style="margin-top:1rem;color:var(--ink)"><strong>$417/SF</strong> isn’t a projection — it’s a signed contract, the highest in 75229, and JoJo is the listing agent. It’s the anchor under every target price in this deck.</p></div>
  </div>
  <p class="foothint">Purchase figures from the recorded settlement statement (3/20/2025). Build cost owner-estimated; sale under contract.</p>
</div></section>

<section class="sand" style="background:var(--sand)"><div class="wrap">
  <div class="deal">
    <span class="badge">Active Build</span>
    <div class="eyebrow">Acquired Jun 2026</div>
    <h2>3316 Townsend Drive</h2>
    <p style="color:rgba(250,249,245,.75);margin-top:1rem;max-width:60ch">The next build — acquired. A 5,500 SF transitional modern, priced off Whitehall’s proven $/SF.</p>
    <div class="grid">
      <div><div class="n">$507K</div><div class="l">Acquisition · Jun 2026</div></div>
      <div><div class="n">$1.07M</div><div class="l">Build budget</div></div>
      <div><div class="n">≈ $1.60M</div><div class="l">All-in incl. holding</div></div>
      <div><div class="n">$2.31M</div><div class="l">Target · $420/SF</div></div>
    </div>
    <div class="foot">≈ $709,000 gross / ≈ $593,000 net at $420/SF — after holding and sale costs.</div>
  </div>
  <p class="foothint">Acquisition from the recorded settlement statement (6/24/2026): $500,000 purchase price, $507K all-in. Build from the project budget ($1,067,325, incl. 5% contingency). Partner-funded — no loan; all-in adds only ~2.5% holding (taxes, insurance, utilities). Target value at $420/SF × 5,500 SF, net of ~5% sale costs — with the listing side captured in-house.</p>
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
  <div style="margin-top:2.2rem;border:1px solid var(--hair);background:var(--paper2);padding:clamp(.7rem,2.5vw,1.4rem)">
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 620" style="width:100%;height:auto;display:block" font-family="Inter, system-ui, sans-serif">
  <rect x="0" y="0" width="900" height="620" fill="#F1F3EF"/>
  <!-- park blocks for map feel -->
  <rect x="150" y="470" width="70" height="40" fill="#D9E6DA" opacity="0"/>
  <!-- street grid -->
  <g stroke="#DCDBD6" stroke-width="6" opacity="0.55">
    <line x1="60" y1="140" x2="840" y2="140"/><line x1="60" y1="240" x2="840" y2="240"/>
    <line x1="60" y1="340" x2="840" y2="340"/><line x1="60" y1="440" x2="840" y2="440"/>
    <line x1="200" y1="90" x2="200" y2="500"/><line x1="330" y1="90" x2="330" y2="500"/>
    <line x1="460" y1="90" x2="460" y2="500"/><line x1="720" y1="90" x2="720" y2="500"/>
  </g>
  <!-- core pocket -->
  <polygon points="120,140 590,140 590,470 120,470" fill="#161616" fill-opacity="0.06" stroke="#8C8A85" stroke-width="2.5" stroke-dasharray="9 7"/>
  <!-- Marsh divider (bold road) -->
  <line x1="590" y1="70" x2="590" y2="520" stroke="#161616" stroke-width="9"/>
  <text x="590" y="52" text-anchor="middle" fill="#161616" font-size="27" font-weight="700" letter-spacing="2">MARSH LN</text>
  <!-- compass -->
  <g transform="translate(820,110)">
    <circle r="26" fill="#fff" stroke="#C9C7C1" stroke-width="1.5"/>
    <path d="M0,-19 L7,6 L0,0 L-7,6 Z" fill="#B23A2E"/>
    <text x="0" y="-30" text-anchor="middle" fill="#6E6C67" font-size="15" font-weight="600">N</text>
  </g>
  <!-- road labels -->
  <text x="132" y="128" fill="#6E6C67" font-size="18">Northaven Rd</text>
  <text x="132" y="492" fill="#6E6C67" font-size="18">Royal Ln</text>
  <text x="86" y="300" fill="#6E6C67" font-size="18" transform="rotate(-90 86 300)">Webb Chapel Rd</text>
  <!-- pocket title + price -->
  <text x="150" y="185" fill="#161616" font-size="23" font-weight="700" letter-spacing="1.5">ATTERRA CORE POCKET</text>
  <text x="150" y="255" fill="#161616" font-size="52" font-weight="700" font-family="'Bodoni Moda',Georgia,serif">$377</text>
  <text x="285" y="255" fill="#6E6C67" font-size="22">/SF avg</text>
  <!-- numbered property markers -->
  <g font-size="21" font-weight="700" fill="#fff" font-family="Inter,sans-serif">
    <circle cx="230" cy="330" r="17" fill="#161616"/><text x="230" y="337" text-anchor="middle">1</text>
    <circle cx="330" cy="330" r="17" fill="#161616"/><text x="330" y="337" text-anchor="middle">2</text>
    <circle cx="430" cy="330" r="17" fill="#161616"/><text x="430" y="337" text-anchor="middle">3</text>
  </g>
  <!-- Vinecrest across Marsh -->
  <circle cx="660" cy="300" r="14" fill="#B23A2E"/>
  <circle cx="660" cy="300" r="25" fill="none" stroke="#B23A2E" stroke-width="3"/>
  <text x="640" y="360" fill="#161616" font-size="21" font-weight="700">3787 VINECREST</text>
  <text x="700" y="300" fill="#161616" font-size="52" font-weight="700" font-family="'Bodoni Moda',Georgia,serif" dominant-baseline="middle">$541</text>
  <text x="700" y="335" fill="#6E6C67" font-size="20">/SF</text>
  <!-- cross-marsh arrow -->
  <text x="300" y="555" text-anchor="middle" fill="#161616" font-size="30" font-weight="700" font-family="'Bodoni Moda',Georgia,serif">$377</text>
  <line x1="370" y1="548" x2="560" y2="548" stroke="#B23A2E" stroke-width="3"/>
  <polygon points="560,548 545,541 545,555" fill="#B23A2E"/>
  <text x="470" y="533" text-anchor="middle" fill="#8C8A85" font-size="16" letter-spacing="1">cross Marsh · +$164/SF</text>
  <text x="640" y="555" text-anchor="middle" fill="#B23A2E" font-size="30" font-weight="700" font-family="'Bodoni Moda',Georgia,serif">$541</text>
</svg>
  <div class="maplegend">
    <span><b>1</b> 3239 Whitehall · $417/SF · under contract</span>
    <span><b>2</b> 3316 Townsend · 5,500 SF · active build</span>
    <span><b>3</b> 3229 Jubilee · $420/SF · coming soon</span>
  </div>
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
    <tr><td>You fund the project · all-in</td><td class="n" style="text-align:right">≈ $1,600,000</td></tr>
    <tr><td>Net profit · after holding &amp; sale costs</td><td class="n" style="text-align:right">≈ $489,000</td></tr>
    <tr><td>Your capital — returned first</td><td class="n" style="text-align:right">$1,600,000</td></tr>
    <tr><td>Your profit share — 25% (1 of 4)</td><td class="n" style="text-align:right">≈ $122,000</td></tr>
    <tr><td><strong>Total back to you</strong></td><td class="n" style="text-align:right"><strong>≈ $1,722,000</strong></td></tr>
  </tbody></table>
  <p class="lead" style="margin-top:1.6rem">≈ <strong>$122,000 profit on ≈ $1.6M funded</strong> — about <strong>7.6%</strong> over a 6–8 month build (≈ 11% annualized), with every dollar of capital returned first. Modeled conservatively on Townsend at $400/SF — the proven market max; at the $420 target the same deal returns ≈ 9.3% (≈ 14% annualized). Partners fund directly — no lender, no leverage. Capital is at risk — see Risk &amp; Mitigation.</p>
</div></section>

<section class="sand" style="background:var(--sand)"><div class="wrap"><div class="eyebrow">Development Pro Forma · By Size &amp; Price</div>
  <h2>Every size, every price — it pays.</h2>
  <p class="lead">One cost model, built from real numbers and underwritten conservatively: land at our Townsend basis of <strong>$507K</strong>, construction at <strong>$194/SF</strong> (the actual Townsend budget), <strong>holding at ~2.5%</strong> of build (taxes, insurance, utilities — partners fund directly, so there’s no loan interest), and <strong>sale costs at 5%</strong>. <em>Net profit</em> is project-level after every cost; <em>Your 25%</em> is the partner’s profit share after capital is returned.</p>

  <div class="cols c2" style="margin-top:2.4rem">
    <div class="card">
      <h3>4,300 SF home</h3>
      <div class="eyebrow" style="color:var(--gold);margin:.55rem 0 0">All-in ≈ $1.36M · land $507K + build $834K + holding $21K</div>
      <table class="table" style="margin-top:1.1rem">
        <thead><tr><th>Reality</th><th>$/SF</th><th>Sale</th><th>Net profit</th><th>Your 25%</th></tr></thead>
        <tbody>
          <tr><td>Current market</td><td class="n">$378</td><td class="n">$1.63M</td><td class="n">$182K</td><td class="n">$46K</td></tr>
          <tr><td>Market max</td><td class="n">$400</td><td class="n">$1.72M</td><td class="n">$272K</td><td class="n">$68K</td></tr>
          <tr><td><strong>Aterra target</strong></td><td class="n"><strong>$420</strong></td><td class="n">$1.81M</td><td class="n"><strong>$354K</strong></td><td class="n"><strong>$88K</strong></td></tr>
        </tbody>
      </table>
    </div>
    <div class="card">
      <h3>5,200 SF home</h3>
      <div class="eyebrow" style="color:var(--gold);margin:.55rem 0 0">All-in ≈ $1.54M · land $507K + build $1.01M + holding $25K</div>
      <table class="table" style="margin-top:1.1rem">
        <thead><tr><th>Reality</th><th>$/SF</th><th>Sale</th><th>Net profit</th><th>Your 25%</th></tr></thead>
        <tbody>
          <tr><td>Current market</td><td class="n">$378</td><td class="n">$1.97M</td><td class="n">$326K</td><td class="n">$82K</td></tr>
          <tr><td>Market max</td><td class="n">$400</td><td class="n">$2.08M</td><td class="n">$435K</td><td class="n">$109K</td></tr>
          <tr><td><strong>Aterra target</strong></td><td class="n"><strong>$420</strong></td><td class="n">$2.18M</td><td class="n"><strong>$534K</strong></td><td class="n"><strong>$133K</strong></td></tr>
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
      <div class="l" style="color:var(--paper)">4,300 SF net</div><div class="n">−$74K</div><div class="n">+$15K</div><div class="n">+$97K</div>
      <div class="l" style="color:var(--paper)">5,200 SF net</div><div class="n">+$16K</div><div class="n">+$125K</div><div class="n">+$224K</div>
    </div>
    <div class="foot" style="font-size:1.05rem;margin-top:1.6rem">At target pricing, a full 30% cost overrun still nets +$97K to +$224K — the deal survives its own worst case.</div>
  </div>

  <div class="card" style="margin-top:1.6rem;border-left:3px solid var(--gold)">
    <div class="eyebrow" style="color:var(--gold)">Built-in upside · in-house listing</div>
    <p style="margin-top:.6rem;color:var(--ink)">The net figures above already deduct a full 5% for sale costs. Because Atterra lists every home in-house, the <strong>~2.5–3% listing-side commission — roughly $45K–$65K per home</strong> — is captured by the team rather than paid out. That’s margin the model doesn’t even count.</p>
  </div>

  <p class="foothint">Base case includes holding and sale costs. Land is a fixed cost, so the larger 5,200 SF home spreads it over more sellable feet — bigger home, fatter margin. $/SF anchors: current market $378 (blended new-construction comps), market max $400 (top closed comp — 10917 Beauty at $397/SF), Atterra target $420 (3239 Whitehall under contract at $417/SF; 3229 Jubilee coming soon, target $420/SF). Construction held flat at Townsend’s $194/SF; holding ≈ 2.5% of build (no loan interest); stress test adds 30% to all hard costs.</p>
</div></section>

<section><div class="wrap"><div class="eyebrow">Use of Funds &amp; Timeline</div><h2>Where capital goes — and when it returns.</h2>
  <div class="cols c2">
    <div>
      <table class="table"><tbody>
        <tr><td>Land acquisition</td><td class="n" style="text-align:right">≈ $507K</td></tr>
        <tr><td>Construction · $194/SF</td><td class="n" style="text-align:right">≈ $0.83–1.07M</td></tr>
        <tr><td>Holding · taxes, insurance, utilities</td><td class="n" style="text-align:right">≈ $25K</td></tr>
        <tr><td>Contingency · in budget</td><td style="text-align:right">5%</td></tr>
      </tbody></table>
    </div>
    <div class="steps">
      <div class="step"><span class="k">01</span><span>Acquire &amp; permit</span><span class="w">Month 0</span></div>
      <div class="step"><span class="k">02</span><span>Build</span><span class="w">Months 1–6</span></div>
      <div class="step"><span class="k">03</span><span>List &amp; sell</span><span class="w">Months 6–8</span></div>
      <div class="step"><span class="k">04</span><span>Return capital</span><span class="w">On close</span></div>
    </div>
  </div>
  <p class="foothint">Partners fund the project directly — no lender ahead of you. Capital is returned in full at close, before any profit split.</p>
</div></section>

<section class="sand" style="background:var(--sand)"><div class="wrap"><div class="eyebrow">Risk &amp; Mitigation</div><h2>We name the risks — and manage them.</h2>
  <div class="cols c2">
    <div class="card"><h3>Market softening</h3><p>Conservative, data-backed values from Area Intel; we buy on a basis the comps support. Our conservative case prices at today’s market, not the $420 target.</p></div>
    <div class="card"><h3>Cost overruns</h3><p>Trade pricing locked at this price point; 5% contingency in every budget; daily PM cost control in-app with a live ledger. We underwrite each deal against a 30% hard-cost overrun — and it still profits at target pricing.</p></div>
    <div class="card"><h3>Timeline slippage</h3><p>A disciplined 6–8 month build with a deliberate schedule buffer and weekly oversight; carrying is light because partners fund directly — there’s no loan clock running.</p></div>
    <div class="card"><h3>Your capital, first out</h3><p>No lender, no leverage — partners fund directly and are repaid in full before any profit is split. Each property is held in its own trust. You’re first in line, not behind a bank.</p></div>
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
