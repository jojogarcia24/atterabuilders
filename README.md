# Aterra Builders

Static, editorial marketing site for **Aterra Builders** (custom residences, Dallas)
plus an **admin dashboard** that tracks inquiries, subscribers, and a signed-in-visitor
**engagement heat score**.

## Pages

| File | Purpose |
|---|---|
| `index.html` | Home — hero, about, why/assurances, services, **process**, founder note, portfolio, **available teaser**, FAQ, service area, inquiry form, subscribe |
| `about.html` | **Our Story** — full-bleed hero + editorial prose + CTA band |
| `available.html` | **Available** — two coming-soon Dallas listings with chic placeholder "renderings" |
| `admin.html` | **Admin** — sign in to see inquiries, subscribers, and the Activity & Heat table |
| `styles.css` | Shared design system (light/airy editorial) |
| `config.js` | **Public** front-end config — fill in your Supabase URL + anon key |
| `site.js` | Nav behavior + inquiry/subscribe form handlers (write to Supabase) |
| `track.js` | Engagement beacon (signed-in visitors only) |
| `sw.js` | Service worker for web-push alerts |
| `netlify/functions/track-engagement.js` | Verifies the JWT, records dwell, fires hot-lead alerts |
| `supabase/schema.sql` | All tables, RLS, and the `get_lead_scores()` heat RPC |
| `assets/hero.jpg` | Shared hero photo |

The site works as **plain static files** today. The forms and admin light up once you
connect Supabase; hot-lead alerts (email / push / GoHighLevel) light up once you deploy
the Netlify function with keys.

## Editable content

Search the HTML for `[Edit:` — those bracketed notes mark the placeholders to replace
with real details (founder name & bio, license number, warranty term). Contact email
and phone live in `config.js`.

## Connect the backend

1. **Supabase** — create/choose a project, open the SQL editor, and run
   `supabase/schema.sql`. Then in **Authentication → Users** add yourself, and run the
   commented `update … set role = 'admin'` at the bottom of the schema for your email.
2. **`config.js`** — set `SUPABASE_URL` and `SUPABASE_ANON_KEY` (Project Settings → API).
   The anon key is safe to expose; **never** put the service-role key here.
   - Now the inquiry & subscribe forms write to Supabase, and `admin.html` shows them.
3. **Hot-lead alerts (optional)** — deploy on **Netlify** and set these env vars
   (Site configuration → Environment variables):
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`
   - `RESEND_API_KEY`, `ATERRA_FROM_EMAIL` (verified sender) — email alerts
   - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` — web push
     (`npx web-push generate-vapid-keys`; also add the public key to `config.js` as
     `VAPID_PUBLIC_KEY` to show the "Enable alerts" button)
   - `ENGAGEMENT_GHL_WEBHOOK_URL` — GoHighLevel inbound webhook (routing/SMS)
   - `ENGAGEMENT_ALERT_SECONDS` (default `120`), `ADMIN_FALLBACK_EMAIL`, `ADMIN_FALLBACK_USER_ID`
   - `npm install` (pulls `web-push`) so the function can bundle it.

## How the heat score works

Only **signed-in** visitors are tracked (privacy + signal quality). `track.js` beacons
dwell time every 30s; the Netlify function verifies the Supabase JWT, records it to
`page_engagement`, and once a visitor spends `ENGAGEMENT_ALERT_SECONDS` on a property it
fires an alert (deduped once per visitor+listing / 24h). `get_lead_scores()` combines
time-on-site, property views, favorites, and return visits into a 0–100 score
(70+ = HOT, 40–69 = Warm). See `assets/../supabase/schema.sql` and
`ENGAGEMENTHEATMAPHANDOFF.md` for the full spec.

## Local preview

```bash
# static preview
python3 -m http.server 8080         # → http://localhost:8080

# with the Netlify function
npm install && npx netlify dev
```
