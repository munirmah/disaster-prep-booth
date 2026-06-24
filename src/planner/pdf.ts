import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { brand } from '../content/brand'
import { formatUsd } from './engine'
import type { Plan } from './types'
import type { PlanMode } from '../settings'

const HF_BLUE: [number, number, number] = [0, 105, 180] // #0069b4
const INK: [number, number, number] = [40, 40, 40]
const MUTED: [number, number, number] = [120, 120, 120]
const MARGIN = 48
const FOOTER_H = 40

/** autoTable records geometry on the doc; the functional import doesn't augment the type. */
const finalYOf = (d: jsPDF) =>
  (d as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY

/** Load an image element so jsPDF can embed it (browser only). */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

/** Draw an image onto a small canvas at (wPt × hPt × scale) px to shrink the embedded size. */
function rasterize(
  img: HTMLImageElement,
  wPt: number,
  hPt: number,
  scale: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(wPt * scale)
  canvas.height = Math.round(hPt * scale)
  const ctx = canvas.getContext('2d')
  if (ctx) ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas
}

function todayLong(): string {
  return new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

/** Letterhead band with the HF logo on a white chip + document title. Returns the y to start content. */
function drawHeader(
  doc: jsPDF,
  pageWidth: number,
  logo: HTMLImageElement | null,
  mode: PlanMode,
): number {
  const bandH = 96
  doc.setFillColor(...HF_BLUE)
  doc.rect(0, 0, pageWidth, bandH, 'F')

  // Logo on a white chip (the HF mark is blue, so it needs a light backing).
  let titleX = MARGIN
  if (logo) {
    const logoH = 30
    const logoW = logoH * (logo.naturalWidth / logo.naturalHeight || 3.5)
    const pad = 8
    const chipW = logoW + pad * 2
    const chipH = logoH + pad * 2
    const chipY = (bandH - chipH) / 2
    doc.setFillColor(255, 255, 255)
    doc.roundedRect(MARGIN, chipY, chipW, chipH, 6, 6, 'F')
    // Downscale the (large) source logo to ~3× display size before embedding,
    // so the PDF stays tens of KB instead of megabytes.
    doc.addImage(rasterize(logo, logoW, logoH, 3), 'PNG', MARGIN + pad, chipY + pad, logoW, logoH)
    titleX = MARGIN + chipW + 18
  }

  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(19)
  doc.text(
    mode === 'prep' ? 'Emergency Kit Prep List' : 'Emergency Kit Shopping List',
    titleX,
    44,
  )
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text('Personalized preparedness plan by household', titleX, 62)

  return bandH
}

/** Household summary + prepared date line below the header band. */
function drawSubheader(doc: jsPDF, summary: string, pageWidth: number, top: number): number {
  const y = top + 26
  doc.setTextColor(...INK)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text(summary, MARGIN, y)

  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...MUTED)
  doc.setFontSize(9)
  doc.text(`Prepared ${todayLong()}`, pageWidth - MARGIN, y, { align: 'right' })

  // Hairline rule under the subheader.
  doc.setDrawColor(220, 226, 232)
  doc.setLineWidth(0.75)
  doc.line(MARGIN, y + 10, pageWidth - MARGIN, y + 10)
  return y + 28
}

/** Running footer on every page: org line, disclaimer, page numbers. */
function drawFooters(doc: jsPDF, pageWidth: number, pageHeight: number) {
  const total = doc.getNumberOfPages()
  const y = pageHeight - 24
  for (let i = 1; i <= total; i++) {
    doc.setPage(i)
    doc.setDrawColor(...HF_BLUE)
    doc.setLineWidth(1)
    doc.line(MARGIN, y - 12, pageWidth - MARGIN, y - 12)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...MUTED)
    // Left: org + website (kept short to clear the centered disclaimer)
    doc.text(`${brand.orgName} · ${brand.website}`, MARGIN, y)
    // Center: disclaimer
    doc.text('Estimates only — confirm in store', pageWidth / 2, y, { align: 'center' })
    // Right: page numbers
    doc.text(`Page ${i} of ${total}`, pageWidth - MARGIN, y, { align: 'right' })
  }
}

/** A left-aligned uppercase section heading. Returns the y below it. */
function sectionHeading(doc: jsPDF, text: string, y: number): number {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(...HF_BLUE)
  doc.text(text, MARGIN, y)
  return y + 14
}

/** Draw the per-store "to buy" tables. Returns the new cursor y. */
function drawBuyTables(doc: jsPDF, buy: Plan, startY: number): number {
  let cursorY = startY
  for (const group of buy.byStore) {
    autoTable(doc, {
      startY: cursorY,
      head: [[group.store.label, 'Buy', 'Qty', 'Price', 'Total']],
      body: group.items.map((p) => [
        `${p.item.name}\n${p.item.product}`,
        '',
        `${p.qty} ${p.item.unit}`,
        formatUsd(p.item.unitPrice),
        formatUsd(p.lineTotal),
      ]),
      foot: [['', '', '', 'Subtotal', formatUsd(group.subtotal)]],
      theme: 'striped',
      headStyles: { fillColor: HF_BLUE, halign: 'left', fontSize: 10 },
      footStyles: { fillColor: [235, 240, 246], textColor: 30, fontStyle: 'bold' },
      styles: { fontSize: 9, cellPadding: 5, valign: 'middle' },
      columnStyles: {
        1: { halign: 'center', cellWidth: 34 },
        2: { cellWidth: 64 },
        3: { halign: 'right', cellWidth: 56 },
        4: { halign: 'right', cellWidth: 64 },
      },
      // Draw an empty checkbox in the "Buy" column to tick while shopping.
      didDrawCell: (data) => {
        if (data.section === 'body' && data.column.index === 1) {
          const size = 11
          const x = data.cell.x + (data.cell.width - size) / 2
          const y = data.cell.y + (data.cell.height - size) / 2
          doc.setDrawColor(120)
          doc.roundedRect(x, y, size, size, 2, 2)
        }
      },
      margin: { left: MARGIN, right: MARGIN, bottom: FOOTER_H + 12 },
    })
    cursorY = finalYOf(doc) + 18
  }
  return cursorY
}

/** Draw per-category tables for prep mode. Returns the new cursor y. */
function drawPrepTables(doc: jsPDF, buy: Plan, startY: number): number {
  let cursorY = startY
  for (const group of buy.byCategory) {
    autoTable(doc, {
      startY: cursorY,
      head: [[group.label, 'Have', 'Qty', 'Price', 'Total']],
      body: group.items.map((p) => [
        `${p.item.name}\n${p.item.product}`,
        '',
        `${p.qty} ${p.item.unit}`,
        formatUsd(p.item.unitPrice),
        formatUsd(p.lineTotal),
      ]),
      theme: 'striped',
      headStyles: { fillColor: HF_BLUE, halign: 'left', fontSize: 10 },
      styles: { fontSize: 9, cellPadding: 5, valign: 'middle' },
      columnStyles: {
        1: { halign: 'center', cellWidth: 34 },
        2: { cellWidth: 64 },
        3: { halign: 'right', cellWidth: 56 },
        4: { halign: 'right', cellWidth: 64 },
      },
      didDrawCell: (data) => {
        if (data.section === 'body' && data.column.index === 1) {
          const size = 11
          const x = data.cell.x + (data.cell.width - size) / 2
          const y = data.cell.y + (data.cell.height - size) / 2
          doc.setDrawColor(120)
          doc.roundedRect(x, y, size, size, 2, 2)
        }
      },
      margin: { left: MARGIN, right: MARGIN, bottom: FOOTER_H + 12 },
    })
    cursorY = finalYOf(doc) + 18
  }
  return cursorY
}

/**
 * Build the branded PDF. `buy` = items still to purchase; `have` = owned items.
 * In shopping mode, groups by store. In prep mode, groups by category.
 * Async because it embeds the HF logo image.
 */
export async function buildPlanPdf(
  buy: Plan,
  have: Plan,
  mode: PlanMode = 'shopping',
): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const boxW = pageWidth - MARGIN * 2
  const fullKitValue = buy.total + have.total

  const logo = await loadImage(brand.logoSrc).catch(() => null)

  const bandBottom = drawHeader(doc, pageWidth, logo, mode)
  // Use whichever plan has the household responses (both carry them).
  const summary = (buy.items.length ? buy : have).summary
  let cursorY = drawSubheader(doc, summary, pageWidth, bandBottom)

  const needHeading = mode === 'prep' ? 'NEED TO GET' : 'NEED TO BUY'
  cursorY = sectionHeading(doc, needHeading, cursorY)
  const hasItems = mode === 'prep' ? buy.byCategory.length > 0 : buy.byStore.length > 0
  if (hasItems) {
    cursorY = mode === 'prep'
      ? drawPrepTables(doc, buy, cursorY)
      : drawBuyTables(doc, buy, cursorY)
  } else {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(11)
    doc.setTextColor(...INK)
    doc.text(`Nothing left to ${mode === 'prep' ? 'get' : 'buy'} — you're all set!`, MARGIN, cursorY + 8)
    cursorY += 22
  }

  // Total-to-buy box.
  if (cursorY > pageHeight - FOOTER_H - 70) {
    doc.addPage()
    cursorY = MARGIN
  }
  doc.setFillColor(...HF_BLUE)
  doc.roundedRect(MARGIN, cursorY, boxW, 38, 6, 6, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text(mode === 'prep' ? 'Total to get' : 'Total to buy', MARGIN + 14, cursorY + 24)
  doc.setFontSize(16)
  doc.text(formatUsd(buy.total), pageWidth - MARGIN - 14, cursorY + 25, { align: 'right' })
  cursorY += 38 + 16

  // ── Already have ────────────────────────────────────────────────────
  if (have.items.length) {
    if (cursorY > pageHeight - FOOTER_H - 90) {
      doc.addPage()
      cursorY = MARGIN
    }
    const haveHeading =
      mode === 'prep' ? 'ALREADY HAVE — NO NEED TO GET' : 'ALREADY HAVE — NO NEED TO BUY'
    cursorY = sectionHeading(doc, haveHeading, cursorY)
    // Match the on-screen framing: prep mode never shows stores, so label the
    // owned items by category instead.
    const haveBody =
      mode === 'prep'
        ? have.byCategory.flatMap((g) =>
            g.items.map((p) => [p.item.name, `${p.qty} ${p.item.unit}`, g.label]),
          )
        : have.byStore.flatMap((g) =>
            g.items.map((p) => [p.item.name, `${p.qty} ${p.item.unit}`, g.store.label]),
          )
    autoTable(doc, {
      startY: cursorY,
      head: [['Item', 'Qty', mode === 'prep' ? 'Category' : 'Store']],
      body: haveBody,
      theme: 'grid',
      headStyles: { fillColor: [120, 120, 120], textColor: [255, 255, 255], fontSize: 9 },
      styles: { fontSize: 9, cellPadding: 4, textColor: 110 },
      columnStyles: { 1: { cellWidth: 70 }, 2: { cellWidth: 90 } },
      margin: { left: MARGIN, right: MARGIN, bottom: FOOTER_H + 12 },
    })
    cursorY = finalYOf(doc) + 14
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(...MUTED)
    doc.text(`Full kit value: ${formatUsd(fullKitValue)}`, pageWidth - MARGIN, cursorY, {
      align: 'right',
    })
    cursorY += 16
  }

  // Categories covered (across the whole kit).
  const cats = [...new Set([...buy.byCategory, ...have.byCategory].map((g) => g.label))]
  if (cats.length) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...MUTED)
    doc.text(`Covers: ${cats.join('  ·  ')}`, MARGIN, cursorY + 6)
  }

  drawFooters(doc, pageWidth, pageHeight)
  return doc
}

/** Trigger a browser download of the plan PDF. */
export async function savePlanPdf(
  buy: Plan,
  have: Plan,
  mode: PlanMode = 'shopping',
  fileName = 'emergency-kit-plan.pdf',
) {
  const doc = await buildPlanPdf(buy, have, mode)
  doc.save(fileName)
}

/** Base64 (no data: prefix) of the PDF, for attaching to the email payload. */
export async function planPdfBase64(
  buy: Plan,
  have: Plan,
  mode: PlanMode = 'shopping',
): Promise<string> {
  const doc = await buildPlanPdf(buy, have, mode)
  const dataUri = doc.output('datauristring')
  return dataUri.slice(dataUri.indexOf(',') + 1)
}
