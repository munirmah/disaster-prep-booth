# Humanity First Disaster-Preparedness Booth

A turnkey software kit for running a disaster-preparedness awareness booth at community events. No technical staff required at the event itself — set it up once and volunteers can manage everything through a simple web interface.

---

## The experience

**At the booth**, a TV runs a continuous loop of preparedness slides — why emergency kits matter, what to stock, local hazard awareness. A QR code stays on screen at all times, inviting visitors to take the next step.

**On visitors' phones**, scanning the QR opens a short form. They answer a few questions about their household — size, children, any special considerations — and the app instantly builds a personalized store-by-store shopping list sized to their family. They can check off what they already own, then download or email themselves a PDF checklist to take shopping.

**Behind the scenes**, Humanity First volunteers manage everything through a password-protected admin panel. Slides, shopping list items, store selections, local hazards, prep window length — all editable without touching any code. Changes go live the moment you press Publish.

---

## What makes it different

**Personalized, not generic.** Every visitor gets a list calculated for their specific household. Quantities, categories, and items all adapt to the answers they gave — a family of six with an infant gets a different list than a couple with a dog.

**Theirs to keep.** Visitors leave with something tangible: a branded PDF checklist they generated themselves, sized to their family, ready to take to the store. They can also email it to themselves on the spot.

**Offline-capable.** The booth display and the phone form both work from a cached copy of the content, so a flaky event WiFi connection doesn't break the experience.

**One admin, many events.** Each deployment can be labeled per event. Volunteers see an anonymous funnel report — how many people reached the booth, built a plan, downloaded or emailed a list — so chapter leadership can measure impact.

**Fully customizable content.** The slide deck, store list, item categories, quantities, and pricing are all data that volunteers edit through the admin. Nothing is hardcoded; the built-in content is a starting point, not a constraint.

---

## How it's built

The app has two pieces: a browser-based display (the booth TV, the phone form, the admin panel) and a small server that holds and serves the content. Both ship as a single downloaded file — nothing to install, no database, no cloud dependency.

The server can authenticate admins via a shared passphrase or directly through an organization's existing Microsoft 365 accounts, with no additional setup on the M365 side beyond a one-time app registration.

For deployment and developer documentation, see [`deploy/README.md`](deploy/README.md) and [`CLAUDE.md`](CLAUDE.md).

---

## License

Copyright © 2026 Humanity First USA. All rights reserved — see [`LICENSE`](LICENSE).
Source is available for reference; contact us for permission to use or deploy.
