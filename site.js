/* ================================================================
   ATERRA BUILDERS — shared front-end behavior
   Header scroll state, mobile drawer, reveal-on-scroll, and the
   inquiry + subscribe forms (write straight to Supabase via REST
   using the anon key + insert-only RLS policies).
   ================================================================ */
(function () {
  var cfg = window.ATERRA_CONFIG || {};

  /* ---- reveal on scroll ---- */
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { threshold: .16, rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll('.reveal').forEach(function (el) { io.observe(el); });
  document.body.classList.add('loaded');

  /* ---- header scrolled state ---- */
  var header = document.getElementById('site-header');
  if (header && !header.classList.contains('solid')) {
    var onScroll = function () { header.classList.toggle('scrolled', window.scrollY > window.innerHeight * 0.72); };
    onScroll(); window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ---- mobile drawer ---- */
  var menuBtn = document.querySelector('.menu-btn');
  var drawer = document.querySelector('.drawer');
  if (menuBtn && drawer) {
    var openD = function () { drawer.classList.add('open'); document.body.style.overflow = 'hidden'; };
    var closeD = function () { drawer.classList.remove('open'); document.body.style.overflow = ''; };
    menuBtn.addEventListener('click', openD);
    drawer.querySelectorAll('a,[data-close]').forEach(function (a) { a.addEventListener('click', closeD); });
  }

  /* ---- Supabase REST insert helper ---- */
  function insertRow(table, row) {
    if (!cfg.SUPABASE_URL || /YOUR_/.test(cfg.SUPABASE_URL) || /YOUR_/.test(cfg.SUPABASE_ANON_KEY || '')) {
      return Promise.reject(new Error('not-configured'));
    }
    return fetch(cfg.SUPABASE_URL + '/rest/v1/' + table, {
      method: 'POST',
      headers: {
        apikey: cfg.SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + cfg.SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify(row)
    }).then(function (r) {
      if (r.status === 409) return true;   // already exists (e.g. duplicate subscriber) — treat as success
      if (!r.ok) return r.text().then(function (t) { throw new Error(t || ('HTTP ' + r.status)); });
      return true;
    });
  }

  function setNote(el, msg, kind) {
    if (!el) return;
    el.textContent = msg;
    el.className = 'form-note' + (kind ? ' ' + kind : '');
  }

  /* ---- inquiry form ---- */
  var lead = document.getElementById('lead-form');
  if (lead) {
    var leadNote = document.getElementById('lead-note');
    lead.addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(lead);
      var row = {
        name: (fd.get('name') || '').toString().trim(),
        email: (fd.get('email') || '').toString().trim(),
        phone: (fd.get('phone') || '').toString().trim(),
        project_type: (fd.get('project_type') || '').toString().trim(),
        message: (fd.get('message') || '').toString().trim(),
        source_url: location.href
      };
      if (!row.name || !row.email) { setNote(leadNote, 'Please add your name and email.', 'err'); return; }
      var btn = lead.querySelector('button'); if (btn) btn.disabled = true;
      setNote(leadNote, 'Sending…');
      insertRow('inquiries', row).then(function () {
        lead.reset();
        setNote(leadNote, 'Thank you — we’ll be in touch personally.', 'ok');
      }).catch(function (err) {
        if (err && err.message === 'not-configured') {
          setNote(leadNote, 'Thanks! (Form storage isn’t connected yet — email us at ' + (cfg.CONTACT_EMAIL || 'hello@aterrabuilders.com') + '.)', 'ok');
        } else {
          setNote(leadNote, 'Something went wrong. Please email ' + (cfg.CONTACT_EMAIL || 'hello@aterrabuilders.com') + '.', 'err');
        }
      }).finally(function () { if (btn) btn.disabled = false; });
    });
  }

  /* ---- subscribe form(s) ---- */
  document.querySelectorAll('form.sub-form').forEach(function (form) {
    var note = form.querySelector('.sub-note') || document.getElementById('sub-note');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = (new FormData(form).get('email') || '').toString().trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setNote(note, 'Enter a valid email.', 'err'); return; }
      var btn = form.querySelector('button'); if (btn) btn.disabled = true;
      insertRow('subscribers', { email: email, source_url: location.href }).then(function () {
        form.reset(); setNote(note, 'You’re on the list. Welcome.', 'ok');
      }).catch(function (err) {
        if (err && err.message === 'not-configured') setNote(note, 'Thanks! We’ll add you soon.', 'ok');
        else setNote(note, 'Could not subscribe right now.', 'err');
      }).finally(function () { if (btn) btn.disabled = false; });
    });
  });
})();
