# Email flow — Power Automate (Humanity First M365)

This folder defines the **Power Automate** cloud flow that emails a visitor
their generated emergency-kit plan (PDF) from the Humanity First M365 tenant.
The flow's HTTP trigger URL is set in `EMAIL_WEBHOOK_URL` on the Go server —
the SPA never holds it. Email calls go through the Go server, not directly from
the browser.

```
Phone (PlanResult) ──POST JSON──▶ Go /api/email ──POST text/plain──▶ Power Automate HTTP trigger
                                                                       ├─ Parse JSON (payload)
                                                                       ├─ Send an email (V2)  ← from tenant mailbox, PDF attached
                                                                       └─ Response 200
```

Files:
- **`flow-definition.json`** — the full workflow definition (Logic Apps schema).
  Use it as the source-of-truth spec; Logic Apps users can import it directly.
  For Power Automate, build the flow with the clicks below — importing needs a
  pre-wired Office 365 connection, so manual is more reliable.
- **`payload-schema.json`** — the JSON Schema for the request body. Paste it
  into both the trigger and the Parse JSON action.

---

## Build it (manual, ~10 minutes)

1. **make.powerautomate.com** → **Create** → **Instant cloud flow**.
   - Name: `Disaster Prep — Email Kit Plan`
   - Trigger: **When an HTTP request is received** → Create.

2. **Trigger → Request Body JSON Schema**: paste the contents of
   `payload-schema.json`. (The URL isn't generated until you save — step 6.)

3. **+ New step → Parse JSON** (search "Parse JSON").
   - **Content**: expression `triggerBody()`  ← important: the SPA sends
     `Content-Type: text/plain` (to avoid a CORS preflight the trigger can't
     answer), so the body arrives as a string and must be parsed here.
   - **Schema**: paste `payload-schema.json` again.
   - Rename the action to **`Parse_payload`** (so the field references match).

4. **+ New step → Office 365 Outlook → Send an email (V2)**.
   - Sign in once with the tenant mailbox you want as the sender
     (e.g. `disasterprep@humanityfirstusa.org`). This creates the connection.
   - **To** → `to` (from Parse_payload)
   - **Subject** → `subject`
   - **Body** → click the `</>` (code view) and insert `html` so it sends as HTML
   - **Advanced options → Attachments**:
     - Attachments Name – 1 → `attachmentName`
     - Attachments Content – 1 → expression `base64ToBinary(body('Parse_payload')?['attachmentBase64'])`
       ⚠️ You **must** use the expression (not the dynamic-content picker) and wrap with
       `base64ToBinary()` — the connector's ContentBytes field is binary, not a string.
       Passing the base64 string directly causes double-encoding and a corrupt PDF.

5. **+ New step → Response** (Request connector → Response).
   - **Status Code**: `200`
   - **Headers**: add `Access-Control-Allow-Origin` = `*`
     and `Content-Type` = `application/json`
   - **Body**: `{ "status": "sent" }`
   - ⚠️ This CORS header is **required** — without it the browser blocks the SPA
     from reading the result and the form shows a false error even though the
     email sent.
   - (Optional) add a second Response configured to run on failure — see
     `Response_Error` in `flow-definition.json`.

6. **Save.** Reopen the trigger to copy the generated **HTTP POST URL**.

7. Put that URL in the app's env as **`VITE_EMAIL_WEBHOOK_URL`** (see
   `../.env.example`) and rebuild. Email then appears on the phone results screen.

---

## Payload the SPA sends

`sendPlanEmail()` (`src/planner/email.ts`) POSTs this JSON body:

```json
{
  "to": "visitor@example.com",
  "subject": "Your Humanity First Emergency Kit Plan",
  "html": "<rendered HTML body>",
  "attachmentName": "emergency-kit-plan.pdf",
  "attachmentBase64": "<base64 PDF, no data: prefix>",
  "meta": { "people": 4, "days": 3, "total": 402.75 }
}
```

`attachmentBase64` is already base64 with no `data:` prefix, which is exactly
what the connector's **ContentBytes** expects.

---

## Notes & hardening

- **Sender mailbox**: the email comes from whichever account authorizes the
  Office 365 connection in step 4. Use a shared/service mailbox, not a personal
  one. To send *as* a shared mailbox, use **Send an email from a shared mailbox
  (V2)** instead and set the **Original Mailbox Address**.
- **Open endpoint**: the HTTP trigger URL is unauthenticated (it carries a SAS
  signature in the query string). To reduce abuse from a public booth:
  - add a `Condition` that rejects bodies missing required fields, and/or check
    a shared secret header/field the SPA includes;
  - cap volume with the trigger's concurrency / a daily counter;
  - rotate the URL via the trigger's SAS key if it leaks.
- **Spam/deliverability**: high send volume from a booth can trip tenant limits.
  Consider a plain-text fallback and keep attachments small (the PDF is ~tens of KB).
- **Privacy**: the flow handles visitor email addresses. Don't log full payloads
  long-term; keep only what you need.
```
