# Deploying the Humanity First disaster-prep booth

The whole app is **one self-contained Go binary** — the server with the Vite SPA
embedded. It serves the three surfaces (phone `/` (default), booth `/#/booth`,
admin `/#/admin`) and a tiny content API. Content (slides + planner + settings) is a
single JSON file on disk that HF volunteers edit through the admin and
**Publish**; the booth and every phone read it back.

It runs behind your existing reverse proxy on a subdomain of a domain **you**
control — it does **not** need to be on the humanityfirstusa.org domain; the QR
just points wherever the app is hosted.

```
phone / booth ──▶ Caddy (TLS, your subdomain) ──▶ disasterprep :8080
                                                   ├─ serves the embedded SPA
                                                   └─ GET/POST /api/content → <CONTENT_DIR>/content.json
```

Example config files referenced below sit alongside this README:
[`Caddyfile.example`](Caddyfile.example), [`disasterprep.service`](disasterprep.service).

---

## TL;DR

```bash
# 1. Get the binary (or `make build` from a checkout)
wget -O disasterprep https://github.com/<you>/<repo>/releases/latest/download/disasterprep-linux-amd64
chmod +x disasterprep

# 2. Install + run as a service
sudo useradd --system --home /opt/disasterprep disasterprep
sudo mkdir -p /opt/disasterprep /var/lib/disasterprep
sudo cp disasterprep /opt/disasterprep/
sudo chown -R disasterprep:disasterprep /opt/disasterprep /var/lib/disasterprep
echo "ADMIN_PASSPHRASE=$(openssl rand -hex 24)" | sudo tee /etc/disasterprep.env
sudo chmod 600 /etc/disasterprep.env
sudo cp deploy/disasterprep.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now disasterprep

# 3. Point your proxy at 127.0.0.1:8080 (see deploy/Caddyfile.example), reload Caddy
# 4. Open https://hfprep.yourdomain.com/#/admin, sign in, edit, Publish.
```

---

## 1. Get the binary

**Option A — GitHub Release (recommended).** Tagging a commit `v*` builds the
binary in CI (`.github/workflows/release.yml`) for both architectures:

```bash
# amd64 (most VPS) — or use disasterprep-linux-arm64 for ARM hosts
wget -O disasterprep https://github.com/<you>/<repo>/releases/latest/download/disasterprep-linux-amd64
chmod +x disasterprep
```

**Option B — build from a checkout** (Node 22, pnpm 10, Go 1.26):

```bash
make build        # → ./disasterprep  (SPA embedded into the Go binary)
```

`make build` runs `pnpm build`, stages `dist/` into `server/web`, and compiles a
static `CGO_ENABLED=0` binary.

---

## 2. Install on the VPS

```bash
sudo useradd --system --home /opt/disasterprep disasterprep
sudo mkdir -p /opt/disasterprep /var/lib/disasterprep
sudo cp disasterprep /opt/disasterprep/
sudo chown -R disasterprep:disasterprep /opt/disasterprep /var/lib/disasterprep

# The publish secret (long random string):
echo "ADMIN_PASSPHRASE=$(openssl rand -hex 24)" | sudo tee /etc/disasterprep.env
sudo chmod 600 /etc/disasterprep.env

sudo cp deploy/disasterprep.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now disasterprep
```

The shipped [`disasterprep.service`](disasterprep.service) sets `PORT=8080`,
`CONTENT_DIR=/var/lib/disasterprep`, reads `/etc/disasterprep.env`, restarts on
failure, and is sandboxed (`ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`,
`NoNewPrivileges`, with `ReadWritePaths=/var/lib/disasterprep`).

Check it came up:

```bash
systemctl status disasterprep
curl -fsS http://127.0.0.1:8080/api/health   # → ok
```

---

## 3. Reverse proxy (TLS)

Add the block from [`Caddyfile.example`](Caddyfile.example) to your existing
Caddyfile and reload — Caddy provisions/renews HTTPS automatically:

```caddy
hfprep.yourdomain.com {
	reverse_proxy 127.0.0.1:8080
}
```

```bash
sudo systemctl reload caddy
```

Any reverse proxy works; just forward your subdomain to `127.0.0.1:8080` and
terminate TLS there. The app is a single origin, so no special routing for
`/api` is needed.

---

## 4. Auth — passphrase ↔ Entra/M365 SSO (auto-selected)

The publish gate's mode is chosen **at runtime from env — no rebuild to switch**:

| Env present | Mode | Admin gate |
|---|---|---|
| `ENTRA_TENANT_ID` **and** `ENTRA_CLIENT_ID` | **SSO** | "Sign in with Microsoft" |
| else `ADMIN_PASSPHRASE` | **passphrase** | passphrase prompt |
| neither | **read-only** | publishing disabled |

In **passphrase** mode the entered string is the credential (constant-time
compared). In **SSO** mode the admin's Microsoft **ID token** is the credential;
the server validates it with the standard library only — RS256 signature against
the tenant JWKS, plus `aud == client id`, `iss`, `exp` (with a 2-min clock-skew
grace), and optionally security-group membership.

### One-time Entra app registration (SSO only)

An admin of the tenant holding the volunteer accounts does this once:

1. Entra admin center → **App registrations → New registration**.
2. Platform: **Single-page application (SPA)**. Redirect URI = your app URL,
   e.g. `https://hfprep.yourdomain.com/`.
3. Copy the **Application (client) ID** and **Directory (tenant) ID** into
   `ENTRA_CLIENT_ID` / `ENTRA_TENANT_ID` in `/etc/disasterprep.env`.
4. *(Optional)* to restrict editing to a group, add the **groups** optional claim
   to the token and set `ENTRA_ALLOWED_GROUP` to that group's object id.

No client secret is needed (public SPA flow; the server only *validates* tokens,
never mints them). HF IT controls who can sign in by tenant/group membership —
the operator never manages a user list.

---

## 5. Publishing content (the admin)

1. Open `https://hfprep.yourdomain.com/#/admin`.
2. Sign in (passphrase or Microsoft, per the mode above).
3. Edit slides, the planner (questions/stores/items/prices), and settings
   (prep days, hazards). The live preview shows exactly what the phone renders.
4. Press **Publish**. The booth and phones pick up the new document on next
   load. The previous version is backed up automatically (see §7).

Until anything is published the app serves its **built-in defaults**, so a fresh
box is never blank.

---

## 6. Email (optional)

Emailed plans go through a **Microsoft Power Automate** flow (no backend you
host) — see [`power-automate/`](../power-automate/) for the 10-minute build steps
and the exact payload shape.

Email is enabled at **runtime** — no rebuild needed. Add the webhook URL to
`/etc/disasterprep.env`:

```
EMAIL_WEBHOOK_URL=https://prod-XX.westus.logic.azure.com/.../triggers/...
```

Then `systemctl restart disasterprep`. The server exposes `emailEnabled: true`
in `/api/config`, the phone form shows the email field, and plans are forwarded
to the Power Automate flow via the Go server (not directly from the browser).

- If `EMAIL_WEBHOOK_URL` is unset, email is gracefully disabled and the PDF
  download still works. The phone form never shows the email field.
- The Go server forwards the payload to Power Automate as `Content-Type:
  text/plain` so the existing **Parse JSON** action in the flow keeps working
  unchanged.
- The flow's `Access-Control-Allow-Origin: *` Response header is no longer
  required (the browser talks to the Go server, not Power Automate directly),
  but it can be left in place without harm.

---

## 7. Back up the content

The server writes a timestamped backup into `<CONTENT_DIR>/backups/` on every
publish. Still copy the live file off-box:

```bash
# crontab -e  — nightly copy somewhere off the box / to object storage
0 3 * * * cp /var/lib/disasterprep/content.json /var/backups/booth-$(date +\%F).json
```

To roll back: stop the service, copy a backup over `content.json`, start again.

---

## 8. Running the booth / TV

The booth surface is built for an unattended TV read across a room.

- Open `https://hfprep.yourdomain.com/#/booth` in a **fullscreen / kiosk browser**
  (e.g. Chrome `--kiosk`), pointed at that URL. (The root `/` is the phone form
  the QR opens; the slideshow lives at `/#/booth`.)
- The app requests a **screen wake lock**, but that's best-effort and needs a
  secure (HTTPS) context — **also disable OS display sleep / screensaver** on the
  booth machine. Don't rely on the wake-lock API alone.
- The QR on screen opens the phone form; phones fetch the published content
  (including settings) from the server, so there's nothing to configure per
  phone.

---

## 9. Upgrades

```bash
# fetch the new binary (release or `make build`), then:
sudo systemctl stop disasterprep
sudo cp disasterprep /opt/disasterprep/
sudo chown disasterprep:disasterprep /opt/disasterprep/disasterprep
sudo systemctl start disasterprep
```

Content lives in `CONTENT_DIR`, separate from the binary, so upgrades never
touch published data.

---

## 10. Reports (visitor analytics)

The booth records an **anonymous funnel** so leadership can see whether an event
worked, with no third-party analytics and no personal data leaving the box.

- **What's tracked** — four steps: a phone opened the planner (*reached*), built
  a plan (*engagement*), and downloaded or emailed it (*takeaway*). The plan step
  also carries **anonymous household counts** (people, # with children / infants /
  pets / medical needs, active hazards) for the "people covered" line.
- **What's NOT tracked** — no names, no email addresses, no IPs. `sid` is a random
  opaque per-device id used only to dedupe refreshes; an `email_sent` records only
  *that* one was sent, never to whom.
- **Where it lives** — appended as NDJSON to `<CONTENT_DIR>/events.ndjson` by the
  same binary. Tiny (a few hundred lines/day); back it up alongside `content.json`
  if you want to keep the history.
- **Reading it** — open `/#/admin` → **Report** tab. Name each event in
  `/#/admin` → **Config** (no SSH/restart) so its report is labelled and
  filterable. The tab shows headline numbers, a per-day table, the busiest hours,
  active hazards, and **what the community already has vs. needs** (anonymous,
  per item), plus **Copy summary** / **CSV** / **PDF report** export. `GET
  /api/stats` is gated by the same publish credential — so a read-only server (no
  passphrase / SSO) has no report.

---

## Quick public demo (Tailscale Funnel)

To show the booth to someone off your network **without** a VPS or DNS, the
Makefile has a one-shot target that runs the binary locally and exposes it on a
public HTTPS URL via [Tailscale Funnel](https://tailscale.com/kb/1223/funnel):

```bash
make demo                 # builds, runs on :8080, prints a public https URL
make demo DEMO_PORT=9000  # different port
```

It starts the server in the background and runs `tailscale funnel` in the
foreground; **Ctrl-C** tears down the funnel and stops the server. It uses the
dev passphrase (`devsecret`) and `./data`, so the admin works during the demo.

**Prerequisites:**
- Tailscale installed and logged in (`tailscale up`), and **Funnel enabled for
  the tailnet** (HTTPS certs + the `funnel` node attribute in your policy file).
  If it isn't, the `tailscale funnel` command prints the exact admin link to turn
  it on.
- If you normally need root for the CLI (`sudo tailscale`), either run it once as
  `sudo tailscale set --operator=$USER` (drops the sudo requirement for good), or
  invoke the target as `make demo TS="sudo tailscale"` — that elevates only the
  tailscale calls, never the build or the server. Don't `sudo make demo`.

This is for demos only — it's not how you run the booth at an event (use the
service + reverse proxy above, §1–§3).

---

## Environment variable reference

Set these in `/etc/disasterprep.env` (or the unit). Runtime vars are read by the
binary; build-time vars must be set before `make build`.

`EVENT_NAME`, `EMAIL_WEBHOOK_URL`, and `ADMIN_PASSPHRASE` are **first-run seeds**:
on first boot they're written to `<CONTENT_DIR>/config.json`, after which you
manage them in `/#/admin` → **Config** (no env edit or restart). `config.json`
wins once it exists — delete it to re-seed from the env.

| Var | When | Default | Meaning |
|-----|------|---------|---------|
| `PORT` | runtime | `8080` | port the binary listens on (behind your proxy) |
| `CONTENT_DIR` | runtime | `data` | where `content.json` + `config.json` + `backups/` + `events.ndjson` live |
| `EVENT_NAME` | seed | `booth` | first-run analytics label; then managed in admin → **Config** (e.g. `"Spring Expo 2026"`) |
| `ADMIN_PASSPHRASE` | seed | _(empty)_ | first-run gate secret; rotate in admin → **Config** (stored hashed). Empty ⇒ read-only unless SSO is set |
| `ENTRA_TENANT_ID` | runtime | _(empty)_ | M365 directory (tenant) id — enables SSO with `ENTRA_CLIENT_ID` |
| `ENTRA_CLIENT_ID` | runtime | _(empty)_ | the SPA app registration's client id (expected `aud`) |
| `ENTRA_ALLOWED_GROUP` | runtime | _(empty)_ | optional: object id of a group allowed to edit |
| `EMAIL_WEBHOOK_URL` | seed | _(empty)_ | first-run email webhook; then managed in admin → **Config**. Empty ⇒ email disabled |
| `VITE_API_BASE` | **build** | _(empty)_ | leave empty in prod (same-origin API); set only for split local dev |
| `VITE_PREP_DAYS` | **build** | `3` | default prep window until content is published |
| `VITE_HAZARDS` | **build** | `winter,flood,hurricane,shelter` | default hazards until content is published |

---

## API endpoints (reference)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/health` | liveness probe → `ok` |
| `GET` | `/api/config` | auth mode + `emailEnabled` flag (SPA reads on load) |
| `GET` | `/api/content` | the published JSON (404 until first publish → client uses built-in defaults) |
| `POST` | `/api/content` | publish (atomic write + timestamped backup); requires the `Authorization: Bearer` credential |
| `POST` | `/api/email` | proxy email to the Power Automate webhook; 503 if `EMAIL_WEBHOOK_URL` is unset |
| `POST` | `/api/event` | record one anonymous funnel event (the phone fires these; public, best-effort) |
| `GET` | `/api/stats` | aggregated report for the admin **Report** tab; requires the `Authorization: Bearer` credential |
| `GET` | `/*` | the embedded SPA |

---

## Troubleshooting

- **Admin shows "read-only" / can't publish** — no `ADMIN_PASSPHRASE` and no
  Entra vars are set. Add one to `/etc/disasterprep.env` and
  `systemctl restart disasterprep`.
- **Publish returns 401** — wrong passphrase, or (SSO) a token failing
  `aud`/`iss`/`exp`/group checks. Re-enter the passphrase; for SSO confirm the
  client/tenant ids and (if used) the allowed group.
- **Email field never appears on the phone form** — `EMAIL_WEBHOOK_URL` is not
  set in the server environment. Add it to `/etc/disasterprep.env` and restart.
- **Email form shows "couldn't send" error** — check `journalctl -u disasterprep`
  for upstream errors reaching Power Automate. Confirm `EMAIL_WEBHOOK_URL` is the
  current trigger URL (Power Automate regenerates it if you rotate the SAS key).
- **Booth screen sleeps** — disable OS display sleep/screensaver; the wake-lock
  API is best-effort and needs HTTPS (§8).
- **Service won't start** — `journalctl -u disasterprep -e`; check the binary is
  executable, owned by the `disasterprep` user, and that `CONTENT_DIR` is
  writable (it's in `ReadWritePaths`).
