/* ================================================================
   ATERRA BUILDERS — public front-end config
   Fill these in with your Supabase project's values (Project
   Settings → API). The anon/publishable key is SAFE to expose
   client-side — never put the service_role key here.
   ================================================================ */
window.ATERRA_CONFIG = {
  // e.g. https://abcd1234.supabase.co
  SUPABASE_URL: 'https://cxreyjttrzkbixzxdssb.supabase.co',
  // the "anon"/"publishable" key from Supabase → Project Settings → API
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN4cmV5anR0cnprYml4enhkc3NiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0NzEwMjksImV4cCI6MjA5OTA0NzAyOX0.-XzUjHd17F3luFU4Pwd8f5SHf-8mqEhZJp0XaM3_Ok8',
  // shown as the reachable contact on the site
  CONTACT_EMAIL: 'hello@aterrabuilders.com',
  CONTACT_PHONE: '(214) 555-0143',
  // GoHighLevel inbound webhook — website inquiries are POSTed here (first/last, email, phone, info)
  GHL_WEBHOOK_URL: 'https://services.leadconnectorhq.com/hooks/31O0ifgQrABoS9mspyTw/webhook-trigger/ab2a78b6-5b9d-4b5e-94d5-cf8e9fd841c2',
  // VAPID public key (safe to expose) — enables the "Enable alerts" button in the admin
  VAPID_PUBLIC_KEY: 'BLykhcwDrl5i2B4ICax-USBFB2i5tBt9-vSOg4AgPv-vQRyy1PfqgSXPf56iFSJ0GRFf_oYuLZWAZ36RCryUXyQ'
};
