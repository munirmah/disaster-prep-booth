import { brand } from '../content/brand'
import { formatUsd, peopleCount } from './engine'
import type { Plan } from './types'
import type { Slide } from '../content/types'
import type { PlanMode } from '../settings'

const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '')

export type EmailResult =
  | { ok: true }
  | { ok: false; reason: 'disabled' | 'network' | 'server' }

/** One distilled point for the email's "Good to know" section. */
export interface DeckTip {
  lead: string
  detail: string
}

/**
 * What the email body carries *beyond* the attached PDF: a few points distilled
 * from the booth deck (`tips`), plus the operator-editable "Go further" actions
 * and resource links (from /api/config). Keeps the body additive rather than a
 * second copy of the shopping list.
 */
export interface EmailExtras {
  tips: DeckTip[]
  nextSteps: string[]
  resources: { label: string; url: string }[]
}

/**
 * Distill the live booth deck into a handful of email-friendly takeaways, so
 * the awareness content a visitor walked past travels home with them. Only
 * `checklist` slides are used: their title + items make a clean, useful text
 * digest. Hazard slides are intentionally skipped — they're terse, visual booth
 * editorial that reads as alarmist out of context, and their `hazard:` label is
 * a display string decoupled from the household's actual risks. Title/quiz
 * slides don't translate to text. Disabled slides are ignored, matching what
 * actually plays.
 */
export function deckTips(slides: Slide[], max = 4): DeckTip[] {
  const tips: DeckTip[] = []
  for (const s of slides) {
    if (s.enabled === false) continue
    if (s.type === 'checklist') {
      const items = s.items.map((i) => i.trim()).filter(Boolean).slice(0, 3)
      const title = s.title.trim()
      if (title && items.length) tips.push({ lead: title, detail: items.join(' · ') })
    }
    if (tips.length >= max) break
  }
  return tips
}

export async function sendPlanEmail(
  buy: Plan,
  have: Plan,
  to: string,
  extras: EmailExtras,
  mode: PlanMode = 'shopping',
): Promise<EmailResult> {
  const { planPdfBase64 } = await import('./pdf')
  const logoDataUri = await fetchLogoDataUri()

  const payload = {
    to,
    subject: `Your ${brand.orgName} Emergency Kit ${mode === 'prep' ? 'Prep List' : 'Shopping List'}`,
    html: buildEmailHtml(buy, have, logoDataUri, extras, mode),
    attachmentName: 'emergency-kit-plan.pdf',
    attachmentBase64: await planPdfBase64(buy, have, mode),
    meta: {
      people: peopleCount(buy.items.length ? buy : have),
      days: buy.days,
      toBuy: buy.total,
      fullKitValue: buy.total + have.total,
    },
  }

  try {
    const res = await fetch(`${API_BASE}/api/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    // 503 means the server has no EMAIL_WEBHOOK_URL configured.
    if (res.status === 503) return { ok: false, reason: 'disabled' }
    return res.ok ? { ok: true } : { ok: false, reason: 'server' }
  } catch {
    return { ok: false, reason: 'network' }
  }
}

// Fetch the logo from the booth server and return it as a data URI so it is
// embedded directly in the email rather than loaded from an external URL.
// Most email clients (Outlook, Gmail mobile) block remote images by default,
// so embedding ensures the logo always displays. Falls back to '' on error;
// buildEmailHtml shows the org name as plain text in that case.
async function fetchLogoDataUri(): Promise<string> {
  if (typeof window === 'undefined') return ''
  try {
    const res = await fetch(`${window.location.origin}/brand/hf-logo-horizontal.png`)
    if (!res.ok) return ''
    const blob = await res.blob()
    return new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.onerror = () => resolve('')
      reader.readAsDataURL(blob)
    })
  } catch {
    return ''
  }
}

// ─── Colour palette (all pre-blended solid hex for Outlook compatibility) ────
//
//  On blue  #0069b4 bg:  secondary text #d9e9f4  (85% white blend, 4.60:1)
//  On white bg:          secondary text #4a6478  (6.18:1)
//  On light bg #e8f2fa:  secondary text #4a6478  (5.48:1)
//  On navy  #062a44 bg:  body text      #8f9fab  (5.32:1)
//                        subtle text    #8395a2  (5.20:1)
//
// rgba() is NOT used anywhere — Outlook 2007-2021 renders rgba as transparent.

function sectionHeading(label: string): string {
  return (
    `<p style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;` +
    `letter-spacing:0.08em;text-transform:uppercase;color:#0069b4;">${label}</p>`
  )
}

function buildEmailHtml(
  buy: Plan,
  have: Plan,
  logoDataUri: string,
  extras: EmailExtras,
  mode: PlanMode = 'shopping',
): string {
  const summaryPlan = buy.items.length ? buy : have
  const fullKitValue = buy.total + have.total
  const buyCount = buy.items.length
  const haveCount = have.items.length

  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const safeHref = (u: string) => (/^https?:\/\//i.test(u) ? esc(u) : '#')
  const sans = 'font-family:Arial,Helvetica,sans-serif;'

  // -- Compact summary: the full list now lives only in the attached PDF, so the
  //    body just teases what's in it (count + total) rather than duplicating it. --
  const summaryCard =
    `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom:10px;border-collapse:separate;">` +
    `<tr><td style="background:#0069b4;border-radius:8px;padding:18px 20px;">` +
    `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">` +
    `<tr>` +
    `<td style="${sans}font-size:13px;font-weight:700;color:#ffffff;">` +
    (buyCount > 0
      ? `${buyCount} item${buyCount === 1 ? '' : 's'} to ${mode === 'prep' ? 'get' : 'buy'}`
      : `You're all set — nothing left to ${mode === 'prep' ? 'get' : 'buy'}`) +
    `</td>` +
    `<td align="right" style="${sans}font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">${formatUsd(buy.total)}</td>` +
    `</tr>` +
    `</table>` +
    `</td></tr>` +
    `</table>` +
    `<p style="margin:0 0 24px;${sans}font-size:12px;color:#4a6478;line-height:1.6;">` +
    (mode === 'prep'
      ? `Your full prep list — every item, organized by category — is <strong style="color:#062a44;">attached as a PDF</strong>.`
      : `Your full shopping list — every item, store and price — is <strong style="color:#062a44;">attached as a PDF</strong>.`) +
    (haveCount > 0
      ? ` You already have ${haveCount} item${haveCount === 1 ? '' : 's'}; full kit value ${formatUsd(fullKitValue)}.`
      : '') +
    `</p>`

  // -- "Good to know": booth-deck takeaways distilled to text. --
  const tipsHtml = extras.tips.length
    ? sectionHeading('Good to know') +
      `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:0 0 24px;">` +
      extras.tips
        .map(
          (t) =>
            `<tr><td style="padding:0 0 12px;">` +
            `<div style="${sans}font-size:14px;font-weight:700;color:#062a44;line-height:1.4;">${esc(t.lead)}</div>` +
            `<div style="${sans}font-size:13px;color:#4a6478;line-height:1.5;margin-top:2px;">${esc(t.detail)}</div>` +
            `</td></tr>`,
        )
        .join('') +
      `</table>`
    : ''

  // -- "Go further": operator-editable next steps. --
  const nextStepsHtml = extras.nextSteps.length
    ? sectionHeading('Go further') +
      `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:0 0 24px;">` +
      extras.nextSteps
        .map(
          (s) =>
            `<tr>` +
            `<td valign="top" style="${sans}font-size:14px;font-weight:700;color:#0069b4;padding:0 10px 10px 0;line-height:1.5;">&rsaquo;</td>` +
            `<td style="${sans}font-size:13px;color:#3a4754;padding:0 0 10px;line-height:1.5;">${esc(s)}</td>` +
            `</tr>`,
        )
        .join('') +
      `</table>`
    : ''

  // -- Resources: operator-editable links. --
  const resourcesHtml = extras.resources.length
    ? sectionHeading('Resources') +
      `<p style="margin:0 0 4px;${sans}font-size:13px;color:#3a4754;line-height:1.9;">` +
      extras.resources
        .map(
          (r) =>
            `<a href="${safeHref(r.url)}" style="color:#0069b4;text-decoration:none;font-weight:600;">${esc(r.label)}</a>`,
        )
        .join('<span style="color:#c4d2dd;">&nbsp;&nbsp;&middot;&nbsp;&nbsp;</span>') +
      `</p>`
    : ''

  // White chip wraps the logo so it contrasts against the blue header in every
  // email client and color mode (same treatment as the booth TV screen).
  // Font properties on the <img> make Outlook render the alt text with brand
  // styling when it blocks the data-URI image.
  const logoInner = logoDataUri
    ? `<img src="${logoDataUri}" width="160" height="43" alt="${brand.orgName}" style="display:block;border:0;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:#0069b4;line-height:43px;">`
    : `<span style="font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;color:#0069b4;">${brand.orgName}</span>`

  const logoImg =
    `<table role="presentation" border="0" cellspacing="0" cellpadding="0">` +
    `<tr><td style="background:#ffffff;border-radius:6px;padding:7px 14px;vertical-align:middle;">` +
    logoInner +
    `</td></tr></table>`

  return (
    `<!DOCTYPE html>` +
    `<html lang="en">` +
    `<head>` +
    `<meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>Your Emergency Kit Shopping List</title>` +
    // Media query: hide the unit-price column on narrow viewports.
    // Supported by Gmail, Apple Mail, Outlook.com, iOS Mail, Thunderbird.
    // Outlook desktop ignores <style> blocks entirely; the 4-column table
    // just renders at full width there, which is fine on a desktop screen.
    `<style>` +
    `@media screen and (max-width:480px){` +
    `.mobile-hide{display:none !important;}` +
    `}` +
    `</style>` +
    `</head>` +
    `<body style="margin:0;padding:0;background:#edf0f4;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;mso-line-height-rule:exactly;">` +

    `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background:#edf0f4;">` +
    `<tr><td align="center" style="padding:32px 16px;">` +

    `<table role="presentation" width="600" border="0" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;border-collapse:separate;">` +

    // HEADER
    `<tr>` +
    `<td style="background:#0069b4;padding:24px 32px 0;border-radius:8px 8px 0 0;">` +
    `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">` +
    `<tr>` +
    `<td style="vertical-align:middle;">${logoImg}</td>` +
    `<td align="right" style="vertical-align:middle;">` +
    `<span style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#d9e9f4;">${brand.tagline}</span>` +
    `</td>` +
    `</tr>` +
    `</table>` +
    `<div style="padding:18px 0 24px;">` +
    `<h1 style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:700;color:#ffffff;line-height:1.25;letter-spacing:-0.2px;">Your Emergency Kit Shopping List</h1>` +
    `<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#d9e9f4;">Personalized preparedness plan for your household</p>` +
    `</div>` +
    `</td>` +
    `</tr>` +

    // SUMMARY BAR
    `<tr>` +
    `<td style="background:#e8f2fa;border-top:2px solid #c4dcf2;border-bottom:1px solid #d0e4f4;padding:14px 32px;">` +
    `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">` +
    `<tr>` +
    `<td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:600;color:#062a44;text-transform:capitalize;">${esc(summaryPlan.summary)}</td>` +
    `<td align="right" style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#4a6478;white-space:nowrap;">Prepared ${today}</td>` +
    `</tr>` +
    `</table>` +
    `</td>` +
    `</tr>` +

    // BODY
    `<tr>` +
    `<td style="padding:28px 32px 4px;">` +

    `<p style="margin:0 0 20px;${sans}font-size:14px;color:#3a4754;line-height:1.6;">` +
    `Thanks for building your family's emergency kit. Here's what's in it, plus a few things worth knowing and where to go next.` +
    `</p>` +

    summaryCard +
    tipsHtml +
    nextStepsHtml +
    resourcesHtml +

    `</td>` +
    `</tr>` +

    // DISCLAIMER
    `<tr>` +
    `<td style="border-top:1px solid #e2e8f0;padding:18px 32px;background:#f8fafc;">` +
    `<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#4a6478;line-height:1.7;">` +
    `Prices in the attached PDF are estimates; confirm in store before purchasing.` +
    `</p>` +
    `</td>` +
    `</tr>` +

    // FOOTER
    `<tr>` +
    `<td style="background:#062a44;padding:18px 32px;border-radius:0 0 8px 8px;">` +
    `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">` +
    `<tr>` +
    `<td style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#8f9fab;">` +
    `${brand.orgName} &nbsp;&middot;&nbsp; <a href="https://${brand.website}" style="color:#8f9fab;text-decoration:underline;">${brand.website}</a>` +
    `</td>` +
    `<td align="right" style="font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#8395a2;letter-spacing:0.05em;text-transform:uppercase;">${brand.motto}</td>` +
    `</tr>` +
    `</table>` +
    `</td>` +
    `</tr>` +

    `</table>` +

    `<p style="margin:16px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#4a6478;text-align:center;">Generated at a ${brand.orgName} disaster preparedness event.</p>` +

    `</td></tr>` +
    `</table>` +

    `</body>` +
    `</html>`
  )
}
