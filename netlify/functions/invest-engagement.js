/* netlify/functions/invest-engagement.js
   Records section-dwell engagement on the private investor deck (/invest?key=…)
   and, when an invited recipient "goes deep," pings Voss (JoJo's assistant) so
   Voss texts JoJo a warm/hot-lead alert — the Aterra mirror of the Elite Living
   deal-platform packet-engagement alert (deal-view.js maybeAlert).

   POST /api/invest-engagement
     { key, session_id, dwellSeconds, sections: { "<label>": <seconds>, … } }
   The `key` is the same 32-hex investor_links token the deck was opened with.
   Nothing here is client-trusted for the alert — thresholds run server-side.

   Env (Netlify):
     SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (required — records + reads links)
     VOSS_ENGAGEMENT_URL     Voss inbound webhook. Default: jojo's aterra-deck-engagement.
     VOSS_ENGAGEMENT_TOKEN   Shared bearer secret for that webhook. Default: INVEST_API_TOKEN
                             (the same token Voss already uses to reach Aterra).
     ATERRA_SITE_URL         Canonical site URL (for the deep link, optional).
*/
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SITE = (process.env.ATERRA_SITE_URL || 'https://aterrabuilders.com').replace(/\/$/, '');
const VOSS_URL = process.env.VOSS_ENGAGEMENT_URL || 'https://jojobroker.netlify.app/api/aterra-deck-engagement';
const VOSS_TOKEN = process.env.VOSS_ENGAGEMENT_TOKEN || process.env.INVEST_API_TOKEN || '';

// Section labels (the deck's .eyebrow text) that signal an investor is studying
// the money — the deck's equivalent of the deal platform's "THE RETURN".
const RETURNS_LABELS = ['investor returns', 'the investment', 'development pro forma', 'the deal', 'use of funds'];
// …and the risk section — the deck's "THE RISKS".
const RISK_LABELS = ['risk'];

// Fire an alert at most once per link per this window (unless it escalates to hot).
const DEBOUNCE_MS = 30 * 60 * 1000;

const svc = { apikey: SR, Authorization: 'Bearer ' + SR, 'Content-Type': 'application/json' };
const rest = (path, opts = {}) => fetch(SUPABASE_URL + '/rest/v1/' + path, { ...opts, headers: { ...svc, ...(opts.headers || {}) } });
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json', ...cors }, body: JSON.stringify(obj) });

function bucketSeconds(sections, labels) {
  let total = 0;
  for (const k of Object.keys(sections)) {
    const kl = k.toLowerCase();
    if (labels.some(l => kl.indexOf(l) !== -1)) total += sections[k] || 0;
  }
  return total;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });
  if (!SUPABASE_URL || !SR) return json(200, { ok: true, skipped: 'not-configured' });

  let b; try { b = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { ok: false, error: 'Bad JSON' }); }
  const raw = String(b.key || '').trim().toLowerCase();
  const m = raw.match(/[0-9a-f]{32}/);
  const key = m ? m[0] : raw;
  if (!key || !/^[a-f0-9]{16,128}$/.test(key)) return json(400, { ok: false, error: 'Invalid link.' });

  // Resolve the active link this beacon belongs to.
  let link;
  try {
    const r = await rest('investor_links?token=eq.' + encodeURIComponent(key) + '&active=eq.true&select=id,name,email,phone,deck,view_count,first_viewed_at,total_dwell_seconds,sections_viewed,engagement_level,engagement_notified_at');
    const rows = r.ok ? await r.json() : [];
    link = rows[0];
  } catch (_) {}
  if (!link) return json(200, { ok: true, skipped: 'no-link' });

  // Merge dwell (keep the MAX seen) and per-section seconds (keep the MAX per section).
  const incomingDwell = Math.max(0, Math.min(36000, parseInt(b.dwellSeconds, 10) || 0));
  const newDwell = Math.max(link.total_dwell_seconds || 0, incomingDwell);
  const existing = (link.sections_viewed && typeof link.sections_viewed === 'object') ? link.sections_viewed : {};
  const incoming = (b.sections && typeof b.sections === 'object') ? b.sections : {};
  const merged = { ...existing };
  for (const k of Object.keys(incoming)) {
    const label = String(k).slice(0, 80);
    const secs = Math.max(0, Math.min(36000, parseInt(incoming[k], 10) || 0));
    if (secs > (merged[label] || 0)) merged[label] = secs;
  }

  const now = new Date().toISOString();
  const patch = {
    total_dwell_seconds: newDwell,
    sections_viewed: merged,
    first_viewed_at: link.first_viewed_at || now,
    last_viewed_at: now
  };
  try { await rest('investor_links?id=eq.' + link.id, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) }); } catch (_) {}

  // ── Thresholds — mirror deal-view.js maybeAlert ──────────────────────────────
  const returns = bucketSeconds(merged, RETURNS_LABELS);
  const risk = bucketSeconds(merged, RISK_LABELS);
  const visits = link.view_count || 0;
  let topLabel = null, topSecs = 0;
  for (const k of Object.keys(merged)) { if ((merged[k] || 0) > topSecs) { topSecs = merged[k]; topLabel = k; } }

  let level = null, reason = '';
  if (returns >= 60 && risk >= 30) { level = 'hot'; reason = 'reviewing the economics seriously'; }
  else if (returns >= 60) { level = 'warm'; reason = 'studying the returns'; }
  else if (newDwell >= 240) { level = 'warm'; reason = 'engaged'; }
  else if (topLabel && topSecs >= 90) { level = 'warm'; reason = 'lingering on ' + topLabel; }
  else if (visits >= 3) { level = 'warm'; reason = 'reviewed ' + visits + '×'; }
  if (!level) return json(200, { ok: true, recorded: true, notified: false });

  // Debounce: one alert per link per 30 min — but let a hot escalation break through a warm hold.
  const last = link.engagement_notified_at ? Date.parse(link.engagement_notified_at) : 0;
  const escalating = level === 'hot' && link.engagement_level !== 'hot';
  if (last && (Date.now() - last) < DEBOUNCE_MS && !escalating) return json(200, { ok: true, recorded: true, notified: false, debounced: true });

  // Stamp the alert first (best-effort) so concurrent beacons don't double-fire.
  try { await rest('investor_links?id=eq.' + link.id, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ engagement_level: level, engagement_notified_at: now }) }); } catch (_) {}

  const deckLabel = link.deck === 'partner' ? 'partner' : 'investor';
  let notified = false;
  if (VOSS_URL && VOSS_TOKEN) {
    try {
      const r = await fetch(VOSS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + VOSS_TOKEN },
        body: JSON.stringify({
          source: 'aterra_deck_engagement',
          level, reason, deck: link.deck, deck_label: deckLabel,
          name: link.name || '', email: link.email || '', phone: link.phone || '',
          total_dwell_seconds: newDwell, returns_seconds: returns, risk_seconds: risk,
          visits, top_section: topLabel || '', deck_url: SITE + '/invest?key=' + key
        })
      });
      notified = r.ok;
    } catch (_) {}
  }
  return json(200, { ok: true, recorded: true, notified, level });
};
