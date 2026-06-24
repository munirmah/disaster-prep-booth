import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { brand } from '../../content/brand'
import type { Stats } from './ReportPanel'

/**
 * Branded, leadership-ready PDF of the booth report — headline impact numbers,
 * who-we-served, the biggest community needs, and the per-day table. Mirrors the
 * shopping-list PDF's letterhead/footer. Lazy-loaded (jsPDF is heavy), so it's
 * only pulled in when an admin taps "PDF report".
 */

const HF_BLUE: [number, number, number] = [0, 105, 180]
const INK: [number, number, number] = [40, 40, 40]
const MUTED: [number, number, number] = [120, 120, 120]
const MARGIN = 48

const finalYOf = (d: jsPDF) => (d as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY
const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0)

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

function rasterize(img: HTMLImageElement, wPt: number, hPt: number, scale: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(wPt * scale)
  canvas.height = Math.round(hPt * scale)
  const ctx = canvas.getContext('2d')
  if (ctx) ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas
}

function dateRange(from?: string, to?: string): string {
  const d = (s?: string) => (s ? s.slice(0, 10) : '')
  const a = d(from)
  const b = d(to)
  return a === b || !b ? a : `${a} → ${b}`
}

function drawHeader(doc: jsPDF, pageWidth: number, logo: HTMLImageElement | null, subtitle: string): number {
  const bandH = 96
  doc.setFillColor(...HF_BLUE)
  doc.rect(0, 0, pageWidth, bandH, 'F')

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
    doc.addImage(rasterize(logo, logoW, logoH, 3), 'PNG', MARGIN + pad, chipY + pad, logoW, logoH)
    titleX = MARGIN + chipW + 18
  }

  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(19)
  doc.text('Disaster-Prep Booth Report', titleX, 44)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(subtitle, titleX, 62)
  return bandH
}

/** Four headline numbers in a row of cards. Returns the y below them. */
function drawHeadline(doc: jsPDF, pageWidth: number, top: number, cells: { value: string; label: string }[]): number {
  const gap = 12
  const w = (pageWidth - MARGIN * 2 - gap * (cells.length - 1)) / cells.length
  const h = 56
  cells.forEach((c, i) => {
    const x = MARGIN + i * (w + gap)
    doc.setFillColor(247, 248, 250)
    doc.roundedRect(x, top, w, h, 6, 6, 'F')
    doc.setTextColor(...HF_BLUE)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(20)
    doc.text(c.value, x + 12, top + 28)
    doc.setTextColor(...MUTED)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.text(c.label, x + 12, top + 44)
  })
  return top + h
}

function sectionHeading(doc: jsPDF, text: string, y: number): number {
  doc.setTextColor(...INK)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text(text, MARGIN, y)
  return y + 8
}

export async function buildReportPdf(stats: Stats, itemName: (id: string) => string): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const t = stats.totals
  const logo = await loadImage(brand.logoSrc).catch(() => null)

  const subtitle = `${stats.event}${stats.range?.from ? ' · ' + dateRange(stats.range.from, stats.range.to) : ''}`
  let y = drawHeader(doc, pageWidth, logo, subtitle) + 26

  y = drawHeadline(doc, pageWidth, y, [
    { value: String(t.planOpens ?? 0), label: 'Phones reached' },
    { value: String(t.plansGenerated ?? 0), label: 'Plans built' },
    { value: `${t.takeaways ?? 0} (${Math.round((t.takeawayRate ?? 0) * 100)}%)`, label: 'Left with a plan' },
    { value: String(t.peopleCovered ?? 0), label: 'People covered' },
  ])
  y += 22

  // Who we served.
  const fam = t.families ?? 0
  doc.setTextColor(...MUTED)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(
    `Served ${fam} families · ${t.familiesWithKids ?? 0} with children · ${t.familiesWithInfants ?? 0} with infants · ${t.familiesWithPets ?? 0} with pets · ${t.familiesWithMedical ?? 0} with medical needs.`,
    MARGIN,
    y,
    { maxWidth: pageWidth - MARGIN * 2 },
  )
  y += 28

  // Community needs.
  const needs = [...(stats.items ?? [])]
    .filter((it) => it.appeared > 0)
    .sort((a, b) => a.have / a.appeared - b.have / b.appeared)
  if (needs.length) {
    y = sectionHeading(doc, 'What the community needs', y) + 6
    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN },
      head: [['Item', 'Already have', 'Families']],
      body: needs.map((it) => [itemName(it.id), `${pct(it.have, it.appeared)}%`, String(it.appeared)]),
      styles: { fontSize: 9, cellPadding: 5 },
      headStyles: { fillColor: HF_BLUE, halign: 'left' },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
      theme: 'striped',
    })
    y = finalYOf(doc) + 26
  }

  // By day.
  if (stats.byDay.length) {
    y = sectionHeading(doc, 'By day', y) + 6
    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN },
      head: [['Date', 'Reached', 'Plans', 'Takeaways', 'People']],
      body: stats.byDay.map((d) => [d.date, String(d.planOpens), String(d.plansGenerated), String(d.takeaways), String(d.peopleCovered)]),
      styles: { fontSize: 9, cellPadding: 5 },
      headStyles: { fillColor: HF_BLUE },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
      theme: 'striped',
    })
  }

  // Footer on every page.
  const pageHeight = doc.internal.pageSize.getHeight()
  const total = doc.getNumberOfPages()
  for (let i = 1; i <= total; i++) {
    doc.setPage(i)
    doc.setDrawColor(...HF_BLUE)
    doc.setLineWidth(0.75)
    doc.line(MARGIN, pageHeight - 30, pageWidth - MARGIN, pageHeight - 30)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...MUTED)
    doc.text(`${brand.orgName} · anonymous booth analytics`, MARGIN, pageHeight - 18)
    doc.text(`Page ${i} of ${total}`, pageWidth - MARGIN, pageHeight - 18, { align: 'right' })
  }
  return doc
}

export async function saveReportPdf(stats: Stats, itemName: (id: string) => string): Promise<void> {
  const doc = await buildReportPdf(stats, itemName)
  doc.save(`booth-report-${stats.event || 'booth'}.pdf`)
}
