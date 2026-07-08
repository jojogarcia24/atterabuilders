/* track.js — Aterra Builders lead engagement tracker (SIGNED-IN users only).
   Reads the Supabase session the Supabase JS SDK stores in localStorage.
   Include on PUBLIC pages only (never on admin.html). No-ops until
   config.js is filled in and a user is signed in. */
(function () {
  var cfg = window.ATERRA_CONFIG || {};
  var url = cfg.SUPABASE_URL || '';
  var m = url.match(/^https?:\/\/([^.]+)\.supabase\.co/i);
  var SUPABASE_REF = m ? m[1] : '';
  if (!SUPABASE_REF || /YOUR_/.test(url)) return;           // not configured yet

  var ENDPOINT = '/.netlify/functions/track-engagement';
  var SEND_EVERY = 30;         // seconds between beacons
  var MIN_DELTA = 5;           // don't send < 5s of new activity

  var p = (location.pathname || '').toLowerCase();
  var SKIP = ['admin', 'login', 'portal', 'account', 'reset-password', 'set-password'];
  if (SKIP.some(function (s) { return p.indexOf(s) !== -1; })) return;

  function token() {
    try {
      var raw = localStorage.getItem('sb-' + SUPABASE_REF + '-auth-token');
      if (!raw) return null;
      var o = JSON.parse(raw);
      var t = o && (o.access_token || (o.currentSession && o.currentSession.access_token) || (Array.isArray(o) && o[0]));
      var exp = o && (o.expires_at || (o.currentSession && o.currentSession.expires_at));
      if (exp && Date.now() / 1000 > exp) return null;
      return t || null;
    } catch (_) { return null; }
  }
  if (!token()) return;   // signed-out — do nothing

  function currentView() {
    var q = new URLSearchParams(location.search);
    var listing = q.get('listing_id') || q.get('id') || '';
    return {
      path: location.pathname, url: location.href,
      title: (document.title || '').replace(/\s*[—|·-]\s*Aterra.*$/i, '').trim(),
      listing_id: listing || '', kind: listing ? 'property' : 'page'
    };
  }

  var view = currentView(), active = 0, sent = 0;
  setInterval(function () { if (document.visibilityState === 'visible') active++; }, 1000);

  function send(final) {
    var delta = active - sent;
    if (delta < (final ? 1 : MIN_DELTA)) return;
    var jwt = token(); if (!jwt) return;
    var payload = JSON.stringify({
      path: view.path, url: view.url, title: view.title,
      listing_id: view.listing_id, kind: view.kind,
      dwell_seconds: delta, cumulative_seconds: active
    });
    sent = active;
    try {
      fetch(ENDPOINT, {
        method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + jwt },
        body: payload
      }).catch(function () {});
    } catch (_) {}
  }

  setInterval(function () {   // detect in-page nav / opening a listing
    var v = currentView();
    if (v.url !== view.url || v.listing_id !== view.listing_id) { send(true); view = v; active = 0; sent = 0; }
  }, 4000);
  setInterval(function () { send(false); }, SEND_EVERY * 1000);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') send(true); });
  window.addEventListener('pagehide', function () { send(true); });
})();
