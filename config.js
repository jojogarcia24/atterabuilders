/* ================================================================
   ATERRA BUILDERS — public front-end config
   Fill these in with your Supabase project's values (Project
   Settings → API). The anon/publishable key is SAFE to expose
   client-side — never put the service_role key here.
   ================================================================ */
window.ATERRA_CONFIG = {
  // e.g. https://abcd1234.supabase.co
  SUPABASE_URL: 'https://YOUR_PROJECT_REF.supabase.co',
  // the "anon"/"publishable" key from Supabase → Project Settings → API
  SUPABASE_ANON_KEY: 'YOUR_SUPABASE_ANON_KEY',
  // shown as the reachable contact on the site
  CONTACT_EMAIL: 'hello@aterrabuilders.com',
  CONTACT_PHONE: '(214) 555-0143',
  // GoHighLevel inbound webhook — website inquiries are POSTed here (first/last, email, phone, info)
  GHL_WEBHOOK_URL: 'https://services.leadconnectorhq.com/hooks/31O0ifgQrABoS9mspyTw/webhook-trigger/ab2a78b6-5b9d-4b5e-94d5-cf8e9fd841c2'
};
