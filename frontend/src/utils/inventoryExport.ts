import type { Article } from 'types/domain';

// Export des Bestands als CSV (für Excel) und als PDF im Design der Jugendfeuerwehr.
// Die CSV-Spalten passen zum Import (POST /api/articles/import).

const CSV_COLUMNS: Array<{ header: string; value: (article: Article) => string | null }> = [
  { header: 'Inventarnummer', value: (a) => a.id },
  { header: 'Kategorie', value: (a) => a.category },
  { header: 'Bezeichnung', value: (a) => a.label },
  { header: 'Größe', value: (a) => a.size },
  { header: 'Status', value: (a) => a.status },
  { header: 'Ort', value: (a) => (a.location.type === 'kind' ? 'Kind' : 'Lager') },
  { header: 'Kind / Lagerort', value: (a) => a.location.name },
  { header: 'Seit', value: (a) => a.assignedAt?.slice(0, 10) ?? null },
  { header: 'Ablaufdatum', value: (a) => a.expiryDate },
  { header: 'Herstellungsdatum', value: (a) => a.helmetManufacturedAt },
  { header: 'Letzte Helmprüfung', value: (a) => a.helmetLastCheck },
  { header: 'Nächste Helmprüfung', value: (a) => a.helmetNextCheck },
  { header: 'Notiz', value: (a) => a.notes }
];

// JF-Farben aus global.css (--bg, --accent)
const JF_NAVY: [number, number, number] = [13, 15, 67];
const JF_ORANGE: [number, number, number] = [254, 151, 6];
const JF_LIGHT: [number, number, number] = [241, 242, 250];

const DATE_FORMAT = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' });
const DATE_TIME_FORMAT = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

export function sortArticlesForExport(articles: Article[]): Article[] {
  return [...articles].sort(
    (a, b) =>
      (a.category || '').localeCompare(b.category || '', 'de-DE') ||
      a.id.localeCompare(b.id, 'de-DE', { numeric: true })
  );
}

export function buildInventoryCsv(articles: Article[]): string {
  // Semikolon als Trennzeichen, damit Excel mit deutscher Ländereinstellung die Spalten erkennt
  const escape = (value: string | null) => {
    let text = value ?? '';
    // Verhindert, dass Excel Notizen wie "=..." als Formel ausführt
    if (/^[=+@\t]/.test(text)) {
      text = `'${text}`;
    }
    return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [
    CSV_COLUMNS.map((column) => column.header).join(';'),
    ...sortArticlesForExport(articles).map((article) =>
      CSV_COLUMNS.map((column) => escape(column.value(article))).join(';')
    )
  ];
  return lines.join('\r\n');
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function exportInventoryCsv(articles: Article[], filenameSuffix = '') {
  // BOM, damit Excel Umlaute als UTF-8 liest
  const blob = new Blob(['﻿' + buildInventoryCsv(articles)], { type: 'text/csv;charset=utf-8' });
  downloadBlob(`bestand${filenameSuffix}_${today()}.csv`, blob);
}

type PdfOptions = {
  title: string;
  /** Beschreibung der Auswahl, z. B. "Alle Artikel" oder "Kind: Max Muster · Kategorie: Jacke" */
  scope: string;
  filenameSuffix?: string;
};

export async function exportInventoryPdf(articles: Article[], options: PdfOptions) {
  // Erst beim Export laden, damit die Bibliothek nicht jede Seite verlangsamt
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const logo = await loadImageAsDataUrl('/ui/logo.png').catch(() => null);

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;
  const headerHeight = 26;
  const createdAt = DATE_TIME_FORMAT.format(new Date());

  const drawHeader = () => {
    doc.setFillColor(...JF_NAVY);
    doc.rect(0, 0, pageWidth, headerHeight, 'F');
    doc.setFillColor(...JF_ORANGE);
    doc.rect(0, headerHeight, pageWidth, 1.2, 'F');
    let textX = margin;
    if (logo) {
      // Logo 469 x 192 px
      const logoHeight = 18;
      const logoWidth = logoHeight * (469 / 192);
      doc.addImage(logo, 'PNG', margin, (headerHeight - logoHeight) / 2, logoWidth, logoHeight);
      textX = margin + logoWidth + 8;
    }
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(options.title, textX, 12);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...JF_ORANGE);
    doc.text(`${options.scope}  ·  ${articles.length} Artikel  ·  Stand ${createdAt}`, textX, 19);
  };

  const rows = sortArticlesForExport(articles).map((article) => [
    article.id,
    article.category,
    article.size ?? '–',
    article.location.type === 'kind' ? article.location.name : 'Lager',
    article.assignedAt ? formatDate(article.assignedAt) : '–',
    formatDate(article.expiryDate),
    formatDate(article.helmetNextCheck),
    article.warning ? (article.warning.type === 'pruefung' ? 'Prüfung fällig' : 'Ablauf') : ''
  ]);

  autoTable(doc, {
    startY: headerHeight + 6,
    margin: { top: headerHeight + 6, left: margin, right: margin, bottom: 14 },
    head: [['Inv.-Nr.', 'Kategorie', 'Größe', 'Bei / Ort', 'Seit', 'Ablauf', 'Nächste Prüfung', 'Hinweis']],
    body: rows,
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 2, textColor: [30, 32, 60], lineColor: [220, 222, 235], lineWidth: 0.1 },
    headStyles: { fillColor: JF_NAVY, textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: JF_LIGHT },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 26 },
      2: { cellWidth: 28 },
      4: { cellWidth: 24 },
      5: { cellWidth: 24 },
      6: { cellWidth: 30 },
      7: { cellWidth: 28, textColor: [200, 100, 0], fontStyle: 'bold' }
    },
    didDrawPage: drawHeader
  });

  // Fußzeile mit Seitenzahlen, nachdem die Gesamtzahl feststeht
  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFontSize(8);
    doc.setTextColor(120, 122, 150);
    doc.text('Jugendfeuerwehr · Digitale Kleiderkammer', margin, pageHeight - 7);
    doc.text(`Seite ${page} von ${pageCount}`, pageWidth - margin, pageHeight - 7, { align: 'right' });
  }

  doc.save(`bestand${options.filenameSuffix ?? ''}_${today()}.pdf`);
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return '–';
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : DATE_FORMAT.format(parsed);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function loadImageAsDataUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Logo konnte nicht geladen werden (${response.status})`);
  }
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
