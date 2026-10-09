import { createWriteStream, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import type { Issue, QaReport, ViewportResult } from '../types/index.js';
import { ensureDir } from '../utils/files.js';

const COLORS = {
  ink: '#101828', muted: '#667085', line: '#D9D9D9', navy: '#182230',
  blue: '#3538CD', paleBlue: '#EEF4FF', green: '#067647', paleGreen: '#ECFDF3',
  red: '#B42318', paleRed: '#FEF3F2', amber: '#93370D', paleAmber: '#FFFAEB', white: '#FFFFFF'
};
const FONT_REGULAR = 'ReportRegular';
const FONT_BOLD = 'ReportBold';
const FONT_REGULAR_FILE = fileURLToPath(new URL('../../node_modules/@fontsource/inter/files/inter-latin-400-normal.woff', import.meta.url));
const FONT_BOLD_FILE = fileURLToPath(new URL('../../node_modules/@fontsource/inter/files/inter-latin-700-normal.woff', import.meta.url));

function clean(value: unknown): string {
  return String(value ?? '')
    .replace(/[\u2011\u2012\u2013\u2014]/g, '-')
    .replace(/×/g, 'x')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/\s+/g, ' ')
    .trim();
}

function statusColors(status: QaReport['status']): { foreground: string; background: string } {
  if (status === 'APROVADO') return { foreground: COLORS.green, background: COLORS.paleGreen };
  if (status === 'INCONCLUSIVO') return { foreground: COLORS.amber, background: COLORS.paleAmber };
  return { foreground: COLORS.red, background: COLORS.paleRed };
}

function severityColor(severity: Issue['severity']): string {
  if (severity === 'CRITICO' || severity === 'ALTO') return COLORS.red;
  if (severity === 'MEDIO') return COLORS.amber;
  return COLORS.blue;
}

function addPageTitle(doc: PDFKit.PDFDocument, title: string, subtitle?: string): void {
  const titleText = clean(title);
  const titleSize = titleText.length > 58 ? 17 : 20;
  doc.fillColor(COLORS.ink).font(FONT_BOLD).fontSize(titleSize);
  const titleHeight = doc.heightOfString(titleText, { width: 499 });
  doc.text(titleText, 48, 45, { width: 499 });
  let cursor = 45 + titleHeight + 4;
  if (subtitle) {
    const subtitleText = clean(subtitle);
    doc.fillColor(COLORS.muted).font(FONT_REGULAR).fontSize(9);
    const subtitleHeight = doc.heightOfString(subtitleText, { width: 499 });
    doc.text(subtitleText, 48, cursor, { width: 499 });
    cursor += subtitleHeight + 9;
  } else {
    cursor += 8;
  }
  doc.moveTo(48, cursor).lineTo(547, cursor).strokeColor(COLORS.line).lineWidth(0.8).stroke();
  doc.y = cursor + 18;
}

function addImageBox(doc: PDFKit.PDFDocument, label: string, imagePath: string, x: number, y: number, width: number, height: number): void {
  doc.fillColor(COLORS.ink).font(FONT_BOLD).fontSize(9).text(clean(label), x, y, { width });
  const top = y + 16;
  doc.roundedRect(x, top, width, height, 5).strokeColor(COLORS.line).lineWidth(0.8).stroke();
  if (existsSync(imagePath)) {
    try {
      doc.image(imagePath, x + 5, top + 5, { fit: [width - 10, height - 10], align: 'center', valign: 'center' });
      return;
    } catch { /* render placeholder below */ }
  }
  doc.fillColor(COLORS.muted).font(FONT_REGULAR).fontSize(9).text('Evidência não disponível', x + 12, top + height / 2 - 5, { width: width - 24, align: 'center' });
}

function addLabelValue(doc: PDFKit.PDFDocument, label: string, value: string, width = 499): void {
  doc.fillColor(COLORS.muted).font(FONT_BOLD).fontSize(8).text(clean(label).toUpperCase(), { width });
  doc.moveDown(0.15);
  doc.fillColor(COLORS.ink).font(FONT_REGULAR).fontSize(10).text(clean(value) || 'Não informado', { width, lineGap: 2 });
  doc.moveDown(0.65);
}

function resultForIssue(report: QaReport, issue: Issue): ViewportResult | undefined {
  const label = issue.viewport.toLowerCase();
  return report.results.find((result) => label.includes(result.viewport) || label.includes(result.dimensions.label.toLowerCase()));
}

function addSummaryPage(doc: PDFKit.PDFDocument, report: QaReport): void {
  doc.rect(0, 0, 595.28, 841.89).fill(COLORS.navy);
  doc.fillColor('#B2CCFF').font(FONT_BOLD).fontSize(10).text('RELATÓRIO DE QA VISUAL', 48, 60, { characterSpacing: 1.4 });
  doc.fillColor(COLORS.white).font(FONT_BOLD).fontSize(30).text(clean(report.task), 48, 92, { width: 499 });
  doc.fillColor('#D0D5DD').font(FONT_REGULAR).fontSize(11).text('Comparação entre a referência do Figma e a implementação de desenvolvimento', 48, 142, { width: 470, lineGap: 3 });

  const status = statusColors(report.status);
  doc.roundedRect(48, 202, 150, 34, 17).fill(status.background);
  doc.fillColor(status.foreground).font(FONT_BOLD).fontSize(12).text(report.status, 48, 213, { width: 150, align: 'center' });

  doc.fillColor(COLORS.white).font(FONT_BOLD).fontSize(13).text('Conclusão', 48, 274);
  const conclusion = report.status === 'INCONCLUSIVO'
    ? 'A validação não pôde determinar a fidelidade visual porque pelo menos uma referência do Figma estava indisponível. Os números de pixel diff desses viewports não devem ser usados.'
    : report.status === 'APROVADO'
      ? 'A implementação atende às regras de aprovação configuradas para esta execução.'
      : 'A implementação possui divergências que ultrapassam as regras de aprovação configuradas.';
  doc.fillColor('#E4E7EC').font(FONT_REGULAR).fontSize(11).text(conclusion, 48, 300, { width: 480, lineGap: 4 });

  const metrics = [
    ['COMPONENTES', report.summary.components], ['CRÍTICOS', report.summary.critical], ['ALTOS', report.summary.high],
    ['MÉDIOS', report.summary.medium], ['BAIXOS', report.summary.low]
  ] as const;
  metrics.forEach(([label, value], index) => {
    const x = 48 + (index % 3) * 166;
    const y = 390 + Math.floor(index / 3) * 82;
    doc.roundedRect(x, y, 150, 62, 7).fill('#243147');
    doc.fillColor('#98A2B3').font(FONT_BOLD).fontSize(7.5).text(label, x + 12, y + 12, { width: 126 });
    doc.fillColor(COLORS.white).font(FONT_BOLD).fontSize(22).text(String(value), x + 12, y + 28, { width: 126 });
  });

  doc.fillColor('#98A2B3').font(FONT_BOLD).fontSize(8).text('FIGMA', 48, 575);
  doc.fillColor(COLORS.white).font(FONT_REGULAR).fontSize(9).text(clean(report.figmaUrl), 48, 590, { width: 480 });
  doc.fillColor('#98A2B3').font(FONT_BOLD).fontSize(8).text('DESENVOLVIMENTO', 48, 632);
  doc.fillColor(COLORS.white).font(FONT_REGULAR).fontSize(9).text(clean(report.developmentUrl), 48, 647, { width: 480 });
  doc.fillColor('#98A2B3').font(FONT_REGULAR).fontSize(8).text(`Gerado em ${new Date(report.createdAt).toLocaleString('pt-BR')}`, 48, 710, { width: 480 });
}

function addViewportPage(doc: PDFKit.PDFDocument, result: ViewportResult): void {
  doc.addPage();
  addPageTitle(doc, `${result.dimensions.label} ${result.dimensions.width}x${result.dimensions.height}`, `${result.deterministicIssues.length + result.codexIssues.length} problema(s) identificado(s)`);
  if (!result.referenceAvailable) {
    doc.roundedRect(48, 110, 499, 58, 6).fill(COLORS.paleAmber);
    doc.fillColor(COLORS.amber).font(FONT_BOLD).fontSize(10).text('Referência do Figma indisponível', 62, 124, { width: 470 });
    doc.fillColor(COLORS.amber).font(FONT_REGULAR).fontSize(9).text(clean(result.referenceError ?? 'Não foi possível carregar a referência.'), 62, 141, { width: 470 });
    doc.y = 188;
  }
  const imageY = doc.y;
  addImageBox(doc, 'FIGMA', result.screenshots.figma, 48, imageY, 241, 215);
  addImageBox(doc, 'DESENVOLVIMENTO', result.screenshots.development, 306, imageY, 241, 215);
  doc.y = imageY + 252;
  if (result.referenceAvailable) {
    addImageBox(doc, `PIXEL DIFF ${(result.pixelDiff.ratio * 100).toFixed(2)}%`, result.screenshots.diff, 48, doc.y, 499, 220);
  } else {
    doc.fillColor(COLORS.muted).font(FONT_REGULAR).fontSize(10).text('Pixel diff não executado porque a referência não é válida.', 48, doc.y + 18, { width: 499 });
  }
}

function addIssuePage(doc: PDFKit.PDFDocument, report: QaReport, issue: Issue, index: number): void {
  doc.addPage();
  addPageTitle(doc, `Problema ${index + 1} ${clean(issue.component)}`, `${clean(issue.viewport)} | ${clean(issue.severity)} | confiança ${(issue.confidence * 100).toFixed(0)}%`);
  const severityY = doc.y;
  doc.fillColor(severityColor(issue.severity)).font(FONT_BOLD).fontSize(10).text(clean(issue.severity), 48, severityY);
  doc.y = severityY + 25;
  addLabelValue(doc, 'Categoria e propriedade', `${issue.category} - ${issue.property}`);
  addLabelValue(doc, 'Esperado no Figma', issue.expected);
  addLabelValue(doc, 'Encontrado no desenvolvimento', issue.actual);
  addLabelValue(doc, 'Diferença', issue.difference);
  addLabelValue(doc, 'Descrição do problema', issue.description);
  addLabelValue(doc, 'Recomendação', issue.recommendation);

  const result = resultForIssue(report, issue);
  if (!result) return;
  if (doc.y > 465) {
    doc.addPage();
    addPageTitle(doc, `Evidências do problema ${index + 1}`, `${clean(issue.component)} | ${clean(issue.viewport)}`);
  } else {
    doc.moveDown(0.4);
    doc.fillColor(COLORS.ink).font(FONT_BOLD).fontSize(13).text('Evidências');
    doc.moveDown(0.5);
  }
  const imageY = doc.y;
  addImageBox(doc, 'FIGMA', issue.evidence?.figma ?? result.screenshots.figma, 48, imageY, 241, 225);
  addImageBox(doc, 'DESENVOLVIMENTO', issue.evidence?.development ?? result.screenshots.development, 306, imageY, 241, 225);
}

function addFooters(doc: PDFKit.PDFDocument): void {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const previousBottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.fillColor(COLORS.muted).font(FONT_REGULAR).fontSize(8)
      .text(`QA Visual | Página ${index + 1} de ${range.count}`, 48, doc.page.height - 24, { width: 499, align: 'center', lineBreak: false });
    doc.page.margins.bottom = previousBottomMargin;
  }
}

export async function writePdfReport(reportDir: string, report: QaReport, filename = 'qa-visual-report.pdf'): Promise<string> {
  await ensureDir(reportDir);
  const output = path.join(reportDir, filename);
  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: { Title: `Relatório de QA Visual ${clean(report.task)}`, Author: 'QA Figma Cadastra' } });
  doc.registerFont(FONT_REGULAR, FONT_REGULAR_FILE);
  doc.registerFont(FONT_BOLD, FONT_BOLD_FILE);
  const stream = createWriteStream(output);
  doc.pipe(stream);
  addSummaryPage(doc, report);
  report.results.forEach((result) => addViewportPage(doc, result));
  if (report.issues.length) report.issues.forEach((issue, index) => addIssuePage(doc, report, issue, index));
  else {
    doc.addPage();
    addPageTitle(doc, 'Resultado da validação');
    doc.fillColor(COLORS.green).font(FONT_BOLD).fontSize(18).text('Nenhuma divergência reportada.', 48, 140, { width: 499 });
  }
  addFooters(doc);
  doc.end();
  await new Promise<void>((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
  return output;
}
