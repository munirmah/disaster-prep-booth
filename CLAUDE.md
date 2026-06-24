# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A React SPA for a **Humanity First disaster-preparedness booth**, three route
surfaces, served by a **single self-contained Go binary** that also stores
content:

1. **Booth / TV screen** (`/#/booth`) — an unattended, looping awareness display
   with a big **QR code** inviting visitors to build their family's emergency kit.
2. **Phone form** (`/`, the root/default) — what the QR opens. The visitor answers a few
   questions; the app generates a **personalized per-store shopping list**
   (Costco rice, Lowe's shovel…) with a **Need to buy / Have it** toggle per
   item, downloadable as a branded **PDF** or **emailed** (M365 Power Automate).
3. **Admin** (`/#/admin`) — passphrase-gated; HF volunteers edit slides +
   settings and **Publish** to the server.

**Deployment model (important):** the Go server (`server/`) embeds the built SPA
and exposes a content API; it runs on a VPS behind the operator's reverse proxy
(Caddy) on a subdomain they control. Content (slides + planner + settings) is a
single JSON document the server persists to disk and serves to the booth + all
phones. So HF owns content via the admin; the operator just hosts the binary.
See `deploy/README.md`. Design the booth for a TV read across a room (huge type,
no input); the phone/admin for a hand (normal sizes, touch targets).

## Commands

```bash
pnpm install          # Node 22, pnpm 10
pnpm dev              # Vite dev server (http://localhost:5173)
pnpm build            # tsc -b + vite build → dist/
pnpm lint             # ESLint (flat config)

make build            # build the single binary: SPA embedded into the Go server → ./disasterprep
make run              # build + run locally (serves SPA + API on :8080)
cd server && go build # compile just the server (needs server/web populated — run `make web` first)
```

Local full-stack dev: run the Go binary (`make run`, serves :8080) and point the
Vite dev server at it with `VITE_API_BASE=http://localhost:8080` in `.env.local`.
No test runner; `tsc -b` (in `pnpm build`) + `go build` are the gates.

## Architecture

### Routing (`src/App.tsx`)

**HashRouter on purpose** — routes resolve client-side (`/#/booth`), so the build
runs on any static host (GitHub Pages, USB stick, a sub-path) with no server
rewrite rules. `vite.config.ts` also sets `base: './'` for the same reason.
Don't switch to BrowserRouter without committing to a host that does SPA
fallback rewrites.

- `/` → `views/PlanView.tsx` (the phone form — the **default** surface the QR opens)
- `/booth` → `views/BoothView.tsx` (the TV slideshow; the booth machine opens `/#/booth`)
- `/admin` → `views/AdminView.tsx`

### Booth surface — data-driven slide deck

The looping awareness content is **content-as-data**: edit data, not components.

- **`content/slides.ts`** — the ordered `Slide[]` that plays and loops.
- **`content/types.ts`** — the `Slide` discriminated union (`title` |
  `checklist` | `hazard` | `quiz`).
- **`components/slides/registry.tsx`** — the `slide.type` → component dispatch,
  with an `assertNever` exhaustiveness guard.
- **`components/SlideShow.tsx`** — the loop controller (`useAutoAdvance` +
  framer-motion `AnimatePresence`, keyed on `slide.id`). Persistent `Branding`
  header and `ProgressBar` sit outside the animated region so they don't remount.
- **`components/QrPanel.tsx`** — the persistent QR sidebar; encodes `planUrl()`.

**Add a new slide TYPE:** add a variant to the union in `content/types.ts` → add
a `case` in `registry.tsx` (the `assertNever` default makes this a compile error
until you do) → create the component under `components/slides/` → add instances
to `content/slides.ts`.

Timing lives in the data: `useAutoAdvance` re-arms a per-slide timer from each
slide's `durationMs` (not a global interval) and drives `progress` via rAF.
Because there's no input, the quiz can't wait for a tap — `QuizSlide` auto-reveals
its answer after `revealAfterMs` (must be `< durationMs`). Any future
"interactive" slide must self-resolve on a timer the same way.

### Phone surface — the planner

This is the core domain logic, all under **`src/planner/`** and **fully
data-driven** (the questionnaire, stores, items, prices, and quantity formulas
are DATA in `plan-config.ts`, interpreted by `engine.ts`):

- **`types.ts`** — `Responses` (answers keyed by question id), `Question`,
  `Item` (with a declarative `Formula` + optional `Condition`), `PlannerConfig`,
  and `Plan` (pre-grouped by store and category).
- **`plan-config.ts`** — THE EDITABLE CONFIG: questions, stores, items, prices,
  and declarative formulas (e.g. `{ perPerDay: { adults: 2 }, packSize: 5 }` =
  "2 gal/adult/day, 5-gal case"). `people` is a configurable aggregate. Items
  gate on `condition` (`whenPositive`, `whenHazardsAny`, …). **Edit content here**;
  prices are illustrative — confirm before relying on totals.
- **`engine.ts`** — pure `Responses → Plan`. Evaluates each formula, drops
  zero-qty items, groups by store + category. Also `selectItems(plan, keepIds)`
  (used to split a plan into "to buy" vs "already have"), `formatUsd`,
  `householdSummary`, `storeLabel`.
- **`pdf.ts`** — `buildPlanPdf(buy, have)` builds the branded shopping-list PDF
  (letterhead w/ logo, **NEED TO BUY** store tables + "Total to buy", then an
  **ALREADY HAVE** section + "Full kit value", running footer). The logo is
  downscaled (~3×) before embedding so the file stays ~150 KB. **Lazy-loaded** —
  jsPDF is heavy, `await import()`-ed only on download/email (separate chunk).
- **`email.ts`** — `sendPlanEmail(buy, have, to, extras)` POSTs the email HTML +
  base64 PDF to the configured webhook. The **full shopping list lives only in
  the attached PDF**; the email *body* is deliberately additive — a compact
  summary plus three value sections built from `extras` (`EmailExtras`): **Good
  to know** (deck takeaways from `deckTips(slides)`), **Go further**, and
  **Resources**. The latter two are operator-editable (see config below);
  `deckTips` distills the live booth deck so the awareness content travels home.
  See "Email via M365" below.

UI flow (`views/PlanView.tsx`): local two-step state — `FamilyForm` (rendered
from `plan-config.questions`) collects `Responses`, then `PlanResult` shows the
**shopping list**. Each item has a **Need to buy / Have it** toggle (defaults to
Need-to-buy); marking "Have it" drops the item from the total + PDF/email. The
view passes the active `prepDays`/`hazards` (from `useSettings()`) into
`generatePlan`. `NumberStepper` is the touch-friendly counter.

`PlanView` owns `responses` + `have` and persists them to the **visitor's phone**
via `src/visitor.ts` (localStorage `dpb.visitor`, 12-hour TTL), so a refresh/lock
restores the shopping list with marks intact; "Start over" clears it. (The
content document is cached separately under `dpb.content` — see the content
pipeline section below.)

### Booth config vs. form input — important distinction

- **Asked on the form** (`Household`): adults, children, infants, pets,
  medicalNeeds. These vary per visitor.
- **Booth default, visitor-overridable** — `prepDays`: the booth's configured
  value (`PREP_DAYS` default 7, set in the admin) *seeds* the plan, but the
  visitor can change the prep window live on the plan screen via the **Supplies
  for** control in `PlanResult` (`7 / 15 / 30 / Custom`, capped at 30). The choice
  is owned by `PlanView`, scales every quantity through `generatePlan`, persists
  in the visitor session (`visitor.ts`), and resets to the booth default on
  "Start over". It is deliberately *not* a form question (keeps the form short).
- **Set per booth, NOT asked** (`src/config.ts`): `DEFAULT_HAZARDS`. Hazards gate
  hazard-specific items (e.g. the tarp only appears for flood/hurricane; the
  shovel for earthquake/winter). Change per event in the admin — don't add to the
  form.

## Content pipeline & the Go server (the backbone)

All editable content — **slides + planner config + settings** — is one document,
`BoothContent` (`src/content/store.tsx`). It resolves at load in priority order:

1. **server** — `GET {VITE_API_BASE}/api/content` (relative in prod; the Go
   binary serves it). The source of truth for booth + phones.
2. **localStorage cache** (`dpb.content`) — last good copy, for instant paint /
   brief outages.
3. **built-in default** — assembled from `slides.ts` + `plan-config.ts` +
   `DEFAULT_SETTINGS`, so the app never blanks even with no server.

`ContentProvider` wraps the app; `useContent()` returns `{ content, status,
publish }`. Consumers read `content.slides` (`SlideShow`), `content.planner` +
`content.settings` (`PlanView`). **Everything fetched/imported runs through
`sanitizeContent` → `sanitizeDeck` / `sanitizeSettings` / `sanitizePlanner`**, so
a malformed document can never crash the render (it falls back per-field).

**The Go server** (`server/main.go`, stdlib only) is one binary that embeds the
SPA (`//go:embed all:web`, staged by `make web`) and serves:
- `GET /api/content` → the stored JSON (404 if nothing published yet → client
  uses built-in; the admin still shows "Connected").
- `POST /api/content` → atomic write + timestamped backup, gated by `authOK`.
- `GET /api/config` → the **auth mode** (auto-selected, no rebuild):
  `ENTRA_TENANT_ID`+`ENTRA_CLIENT_ID` → `sso`; else a passphrase set (env or
  config) → `passphrase`; else `none`. The admin SPA reads this to pick its gate;
  it also reports whether email is enabled.
- `GET`/`POST /api/admin/config` (gated by `authOK`) → the **self-sufficient
  runtime config** (`server/config.go`): event name, email webhook, admin
  passphrase, and the email's **next-steps + resource links**, persisted to
  `<CONTENT_DIR>/config.json` and read **live** by the handlers. Seeded from
  `EVENT_NAME`/`EMAIL_WEBHOOK_URL`/`ADMIN_PASSPHRASE` on first boot, then edited
  from the admin **Config** tab (`ConfigPanel.tsx`) — no env edits or restart.
  The passphrase is stored **hashed** (salted, iterated SHA-256), never
  plaintext. The next-steps/resources are **public content** (no secret) and are
  echoed by `GET /api/config` so the phone can build the email body; they fall
  back to built-in generic defaults when unset. `PORT`/`CONTENT_DIR` and the auth
  *mode* stay env.
- `POST /api/event` / `GET /api/stats` → **anonymous booth analytics**
  (`server/stats.go`). The phone fires four fire-and-forget funnel events via
  `src/track.ts` — `plan_open`, `plan_generated` (carries anonymous household
  counts only), `pdf_download`, `email_sent` — appended as NDJSON to
  `<CONTENT_DIR>/events.ndjson`. `/api/stats` (gated by `authOK`, same Bearer
  credential as publish) returns aggregates for the admin **Report** tab
  (`components/admin/ReportPanel.tsx`). **Privacy rule — never regress:** no PII
  (no name/email/IP); `sid` is an opaque random dedupe id; unknown event types
  and prop keys are dropped server-side.
- `GET /*` → the embedded SPA.

**Auth** (`src/auth.ts` client, `server/auth.go` server): in **SSO** mode the
admin signs in via MSAL (lazy-imported, so it's a separate chunk — never in the
booth/phone bundles) and the **ID token** is the publish credential; the server
validates it with stdlib only — RS256 signature against the tenant JWKS, plus
`aud`==clientId, `iss`, `exp`, and optional group membership. In **passphrase**
mode the entered passphrase is the credential, checked (constant-time) against
the **hash in `config.json`** — or the bootstrap `ADMIN_PASSPHRASE` env before
first seed — and rotated from the admin **Config** tab. The
admin obtains the credential via `getCredential()` (token or passphrase) and
`content/store.tsx` `publish()` sends it as `Authorization: Bearer`.

**Admin (`/#/admin`)** edits a *draft* copy of the content and **Publish** POSTs
it via `useContent().publish(draft, secret)`; the booth/phones pick it up on next
load. The passphrase entered at the gate is the publish credential (validated
server-side on POST). `SlidesManager` is controlled (operates on
`draft.slides` + `onChange`); the slide editor keeps its live `[container-type:size]`
preview + Export/Import/Reset.

Notes:
- **The QR no longer carries settings** — phones fetch the content document
  (incl. settings) from the server, so `QrPanel` is just the plan URL.
- **`hazards` gates the planner only, NOT the slideshow** (intentional). Hazards
  drive which shopping-list items appear (`engine.ts` `whenHazardsAny`); the
  booth deck is curated editorial content whose `hazard:` field is a display
  string, not the `Hazard` enum. Unchecking "Flood" drops the tarp from the
  phone's list but the Flood awareness slide still plays.
- `src/deck.ts` now holds only slide helpers (`sanitizeDeck`, `newSlide`,
  `sanitizeSlideForPreview`, `builtInDeck`) — the deck lives in the content doc,
  not localStorage. `visitor.ts` (`dpb.visitor`) still persists a visitor's
  in-progress phone session separately.

## Email via M365 (Power Automate)

Email is sent from the **Humanity First M365 tenant without a backend we host**.
`sendPlanEmail()` POSTs the plan + base64 PDF to the server's **`/api/email`
proxy**, which forwards it to a **Power Automate flow** ("When an HTTP request is
received" trigger) that sends via the **Office 365 Outlook connector**. The flow
URL is held server-side in `<CONTENT_DIR>/config.json` (seeded from the
`EMAIL_WEBHOOK_URL` env on first boot, then managed in the admin **Config** tab);
if unset, email is disabled gracefully and the PDF download still works.

**The flow is fully specified in `power-automate/`** — `README.md` (10-minute
manual build steps), `flow-definition.json` (the workflow spec), and
`payload-schema.json` (request body schema). Build the flow to match; the POST
body shape is documented there and mirrored by `src/planner/email.ts`.

**Two non-obvious constraints (don't regress these):**
- **CORS**: the client sends `Content-Type: text/plain` so the browser treats it
  as a CORS "simple request" and skips the preflight OPTIONS that Power Automate
  can't answer. The body is still JSON — the flow parses it with a Parse JSON
  action (`triggerBody()` is a string). Don't switch back to `application/json`.
- The flow's **Response action must send `Access-Control-Allow-Origin: *`**, or
  the browser blocks the SPA from reading the result and the form shows a false
  error even though the mail sent.

(Alternatives — Graph `sendMail` via an Azure AD app, or a serverless function —
are heavier; Power Automate avoids managing secrets and hosting.)

## Branding

Real Humanity First USA branding is applied: official blue **`#0069b4`** (CSS
`:root` in `src/index.css`, mirrored in `src/content/brand.ts`) and the official
horizontal logo at `public/brand/hf-logo-horizontal.png` (oval figure +
"Humanity First / Serving Mankind"). The logo art already includes the wordmark
and tagline, so headers show the logo image plus a context label
(`brand.tagline` = "Disaster Preparedness"), not a duplicate text wordmark. On
the dark booth gradient the logo sits on a white chip for contrast; on the white
phone form it renders directly. The emergency-red accent (`--accent`, `#e63946`)
is ours for urgency/CTA, not an HF brand color. Keep the CSS vars and `brand.ts`
in sync; brand colors are referenced from Tailwind as `text-[var(--accent)]` etc.

## Conventions

- **Tailwind v4** via the `@tailwindcss/vite` plugin + a single
  `@import 'tailwindcss'` in `index.css`. There is **no `tailwind.config.js`** —
  don't add one unless extending the theme.
- **Kiosk CSS is scoped to `.kiosk`** (cursor hidden, no select/scroll), applied
  only on `BoothView`. The phone form must stay fully interactive — never move
  those rules back onto `body`.
- **TV sizing uses viewport units** (`vh`/`vw`) for the booth; the phone form
  uses normal `rem`/Tailwind sizes with a `max-w-md` container.
- **Screen wake lock** (`hooks/useWakeLock.ts`) is owned by `BoothView` and is
  best-effort (needs a secure context). **Also disable OS display sleep** on the
  booth machine — don't rely on the API alone. Run the booth from the built
  output in a fullscreen/kiosk browser.
