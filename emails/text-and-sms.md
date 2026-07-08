# Aterra Builders — plain-text & SMS versions

Merge fields use GHL webhook syntax `{{inboundWebhookRequest.FIELD}}`. If your workflow
creates the contact first, you can swap in `{{contact.first_name}}`, `{{contact.email}}`, etc.

---

## 1) Client auto-reply (to the person who inquired)

**Subject:** Thank you for reaching out — Aterra Builders

**Plain-text email:**
```
Hi {{inboundWebhookRequest.first_name}},

Thank you for reaching out to Aterra Builders. We've received the details about
your project, and someone will personally be in touch with you shortly.

We take on a limited number of residences each year — held by a single hand,
from land to keys — and we're glad you're considering us to build yours.

See what's available: https://aterrabuilders.com/available.html

Warmly,
The Aterra Builders team
hello@aterrabuilders.com

"Built for life, designed for you."
Aterra Builders · Dallas, TX
```

**SMS (client auto-text):**
```
Hi {{inboundWebhookRequest.first_name}}, thanks for reaching out to Aterra Builders — we got your message and will be in touch shortly. — Aterra
```

---

## 2) Admin / Builder — NEW LEAD alert (contact-form inquiry)

**Subject:** 🏛 New inquiry — {{inboundWebhookRequest.first_name}} {{inboundWebhookRequest.last_name}} ({{inboundWebhookRequest.project_type}})

**Plain-text email:**
```
NEW WEBSITE INQUIRY — Aterra Builders

Name:    {{inboundWebhookRequest.first_name}} {{inboundWebhookRequest.last_name}}
Email:   {{inboundWebhookRequest.email}}
Phone:   {{inboundWebhookRequest.phone}}
Project: {{inboundWebhookRequest.project_type}}

Message:
{{inboundWebhookRequest.message}}

Source: {{inboundWebhookRequest.source_url}}
```

**SMS (to the builder):**
```
🏛 New Aterra inquiry: {{inboundWebhookRequest.first_name}} {{inboundWebhookRequest.last_name}} · {{inboundWebhookRequest.project_type}}. Call {{inboundWebhookRequest.phone}} / {{inboundWebhookRequest.email}}
```

---

## 3) Admin / Builder — ENGAGEMENT hot-lead alert

**Subject:** 🔥 Hot lead — {{inboundWebhookRequest.full_name}} is viewing {{inboundWebhookRequest.property}}

**Plain-text email:**
```
🔥 HOT LEAD — Aterra Builders

{{inboundWebhookRequest.full_name}} is spending time on {{inboundWebhookRequest.property}}
right now — the ideal moment to reach out.

Email:    {{inboundWebhookRequest.email}}
Phone:    {{inboundWebhookRequest.phone}}
Property: {{inboundWebhookRequest.property}}
View:     {{inboundWebhookRequest.property_url}}
```

**SMS (to the builder):**
```
🔥 Aterra hot lead: {{inboundWebhookRequest.full_name}} is viewing {{inboundWebhookRequest.property}} now. Reach out — {{inboundWebhookRequest.phone}} / {{inboundWebhookRequest.email}}
```

---

### Notes
- GHL matches/creates contacts by **email/phone** — keep those mapped to the contact's email & phone fields.
- SMS segments are 160 chars; if `message` is long, don't include it in the SMS body (the email carries the full text).
- The engagement (hot-lead) alert only fires for **signed-in** visitors, by design. The new-lead alert fires on every form submission.
