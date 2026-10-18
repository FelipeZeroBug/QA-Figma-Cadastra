import { createWriteStream, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import type { Issue, QaReport, ViewportResult } from '../types/index.js';
import { ensureDir } from '../utils/files.js';

const COLORS = {
  ink: '#24272E', muted: '#667085', line: '#D0D5DD', surface: '#F7F8FA',
  blue: '#3538CD', green: '#067647', paleGreen: '#ECFDF3',
  red: '#B42318', paleRed: '#FEF3F2', amber: '#93370D', paleAmber: '#FFFAEB'
};
const FONT_REGULAR = 'ReportRegular';
const FONT_BOLD = 'ReportBold';
const FONT_REGULAR_FILE = fileURLToPath(new URL('../../node_modules/@fontsource/inter/files/inter-latin-400-normal.woff', import.meta.url));
const FONT_BOLD_FILE = fileURLToPath(new URL('../../node_modules/@fontsource/inter/files/inter-latin-700-normal.woff', import.meta.url));
const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 42;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

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

function resolveImagePath(imagePath: string): string {
  if (existsSync(imagePath)) return imagePath;
  const normalized = imagePath.replaceAll('\\', '/');
  const reportsIndex = normalized.lastIndexOf('/reports/');
  if (reportsIndex >= 0) {
    const movedPath = path.join(PROJECT_ROOT, normalized.slice(reportsIndex + 1));
    if (existsSync(movedPath)) return movedPath;
  }
  return imagePath;
}

function percentageFrom(issue: Issue): string | undefined {
  const match = `${issue.difference} ${issue.actual}`.match(/(\d+(?:[.,]\d+)?)\s*%/);
  return match?.[1]?.replace('.', ',');
}

function compactIssueText(issue: Issue): string {
  const component = clean(issue.component) || 'componente';
  const property = clean(issue.property).toLowerCase();
  if (issue.category === 'REFERENCIA') return `Usar a referência correta para ${clean(issue.viewport)}.`;
  if (issue.category === 'TIPOGRAFIA' || issue.category === 'DIMENSAO') {
    const hasDimensions = /largura|altura/.test(property);
    const hasTypography = /fonte|linha|letras|cor|alinhamento/.test(property);
    const subject = hasDimensions && hasTypography ? 'tipografia e dimensões' : hasDimensions ? 'dimensões' : 'tipografia';
    return `Ajustar ${subject} do componente "${component}".`;
  }
  if (property === 'fidelidade visual da seção' || property === 'fidelidade visual da secao') {
    return `Ajustar o visual da seção "${component}".`;
  }
  if (property.includes('pixel-diff')) return 'Revisar as diferenças visuais gerais da página.';
  if (property.includes('presença') || property.includes('presenca')) return `Corrigir a presença do componente "${component}".`;
  if (property.includes('cor')) return `Ajustar a cor do componente "${component}".`;
  if (property.includes('fonte') || property.includes('tipografia')) return `Ajustar a tipografia do componente "${component}".`;
  if (property.includes('largura')) return `Ajustar a largura do componente "${component}".`;
  if (property.includes('altura')) return `Ajustar a altura do componente "${component}".`;
  if (property.includes('espaçamento') || property.includes('espacamento')) return `Ajustar o espaçamento do componente "${component}".`;
  if (property) return `Ajustar ${property} no componente "${component}".`;
  return `Ajustar o componente "${component}".`;
}

function compactErrorDetail(issue: Issue): string {
  const property = clean(issue.property).toLowerCase();
  const description = clean(issue.description);
  if (issue.category === 'REFERENCIA') return `Erro: ${description}`;
  if (issue.category === 'TIPOGRAFIA' || issue.category === 'DIMENSAO') {
    return `Erro: ${description.replace(/^No componente\s+[“"].+?[”"],\s*/i, '')}`;
  }
  if (property === 'fidelidade visual da seção' || property === 'fidelidade visual da secao') {
    return `Erro: ${description}`;
  }
  if (property.includes('pixel-diff')) return 'Erro: diferenças visuais gerais acima da tolerância.';
  if (property.includes('presença') || property.includes('presenca')) {
    return `Erro: esperado ${clean(issue.expected)}; encontrado ${clean(issue.actual)}.`;
  }
  if (property.includes('cor')) return 'Erro: cor diferente do Figma.';
  if (property.includes('fonte') || property.includes('tipografia')) return 'Erro: fonte, tamanho ou peso diferente do Figma.';
  if (property.includes('largura')) return 'Erro: largura diferente do Figma.';
  if (property.includes('altura')) return 'Erro: altura diferente do Figma.';
  if (property.includes('espaçamento') || property.includes('espacamento')) return 'Erro: espaçamento diferente do Figma.';
  if (property) return `Erro: ${property} diferente do Figma.`;
  return 'Erro: componente diferente da referência do Figma.';
}

function issuesForResult(report: QaReport, result: ViewportResult): Issue[] {
  const resultIssues = [...result.deterministicIssues, ...result.codexIssues];
  const reportIssues = report.issues.filter((issue) => {
    const viewport = issue.viewport.toLowerCase();
    return viewport.includes(result.viewport) || viewport.includes(result.dimensions.label.toLowerCase());
  });
  return reportIssues.length ? reportIssues : resultIssues;
}

function addSectionHeader(
  doc: PDFKit.PDFDocument,
  report: QaReport,
  result: ViewportResult,
  issueCount: number,
  continuation: boolean
): void {
  const title = `Ajustes - ${clean(result.dimensions.label)}`;
  doc.fillColor(COLORS.muted).font(FONT_BOLD).fontSize(7.5)
    .text('RELATÓRIO DE QA VISUAL', MARGIN, 35, { characterSpacing: 1.2 });
  doc.fillColor(COLORS.ink).font(FONT_BOLD).fontSize(25)
    .text(title, MARGIN, 50, { width: 385, lineBreak: false });

  const status = statusColors(report.status);
  doc.roundedRect(PAGE_WIDTH - MARGIN - 91, 48, 91, 25, 12.5).fill(status.background);
  doc.fillColor(status.foreground).font(FONT_BOLD).fontSize(8)
    .text(report.status, PAGE_WIDTH - MARGIN - 91, 57, { width: 91, align: 'center', lineBreak: false });

  const pageContext = continuation ? 'continuação | ' : '';
  const subtitle = `${clean(report.task)} | ${pageContext}${issueCount} ${issueCount === 1 ? 'ajuste' : 'ajustes'} | ${result.dimensions.width}x${result.dimensions.height}`;
  doc.fillColor(COLORS.muted).font(FONT_REGULAR).fontSize(8.5)
    .text(subtitle, MARGIN, 82, { width: CONTENT_WIDTH });
  doc.moveTo(MARGIN, 100).lineTo(PAGE_WIDTH - MARGIN, 100)
    .strokeColor(COLORS.line).lineWidth(0.8).stroke();
  doc.y = 114;
}

function addEvidenceImage(
  doc: PDFKit.PDFDocument,
  label: string,
  imagePath: string,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  doc.fillColor(COLORS.muted).font(FONT_BOLD).fontSize(7.5)
    .text(label, x, y, { width, characterSpacing: 0.7 });
  const imageTop = y + 13;
  doc.roundedRect(x, imageTop, width, height, 5).fillAndStroke(COLORS.surface, COLORS.line);
  const resolvedPath = resolveImagePath(imagePath);
  if (existsSync(resolvedPath)) {
    try {
      doc.image(resolvedPath, x + 4, imageTop + 4, {
        fit: [width - 8, height - 8], align: 'center', valign: 'center'
      });
      return;
    } catch { /* exibe o placeholder abaixo */ }
  }
  doc.fillColor(COLORS.muted).font(FONT_REGULAR).fontSize(8)
    .text('Evidência não disponível', x + 10, imageTop + height / 2 - 4, { width: width - 20, align: 'center' });
}

function addIssueBlock(
  doc: PDFKit.PDFDocument,
  issue: Issue,
  result: ViewportResult,
  number: number,
  imageHeight: number
): void {
  const y = doc.y;
  const title = compactIssueText(issue);
  doc.circle(MARGIN + 5, y + 7, 3).fill(severityColor(issue.severity));
  doc.fillColor(COLORS.ink).font(FONT_BOLD).fontSize(11.5);
  const titleHeight = doc.heightOfString(title, { width: CONTENT_WIDTH - 24, lineGap: 1 });
  doc.text(title, MARGIN + 18, y, { width: CONTENT_WIDTH - 24, lineGap: 1 });

  const percentage = percentageFrom(issue);
  const rawMeta = percentage ? `${percentage}% de divergência`
    : issue.category === 'TIPOGRAFIA' || issue.category === 'DIMENSAO'
      ? clean(issue.property)
      : clean(issue.difference);
  const shortMeta = rawMeta.length > 110 ? `${rawMeta.slice(0, 107)}...` : rawMeta;
  const meta = [clean(issue.severity), shortMeta]
    .filter(Boolean).join(' | ');
  const metaY = y + titleHeight + 4;
  doc.fillColor(severityColor(issue.severity)).font(FONT_BOLD).fontSize(7.5)
    .text(`${number}. ${meta}`, MARGIN + 18, metaY, { width: CONTENT_WIDTH - 24 });

  const errorText = compactErrorDetail(issue);
  const metaHeight = doc.heightOfString(`${number}. ${meta}`, { width: CONTENT_WIDTH - 24, lineGap: 1 });
  const errorY = metaY + metaHeight + 4;
  doc.fillColor(COLORS.muted).font(FONT_REGULAR).fontSize(8.2);
  const errorHeight = doc.heightOfString(errorText, { width: CONTENT_WIDTH - 24, lineGap: 1 });
  doc.text(errorText, MARGIN + 18, errorY, { width: CONTENT_WIDTH - 24, lineGap: 1 });

  if (issue.category === 'REFERENCIA') {
    doc.y = errorY + errorHeight + 24;
    return;
  }

  const evidenceY = errorY + errorHeight + 7;
  const gap = 12;
  const imageWidth = (CONTENT_WIDTH - gap) / 2;
  addEvidenceImage(doc, 'FIGMA', issue.evidence?.figma ?? result.screenshots.figma, MARGIN, evidenceY, imageWidth, imageHeight);
  addEvidenceImage(doc, 'DESENVOLVIMENTO', issue.evidence?.development ?? result.screenshots.development, MARGIN + imageWidth + gap, evidenceY, imageWidth, imageHeight);
  doc.y = evidenceY + imageHeight + 31;
}

function addNoIssuesPage(doc: PDFKit.PDFDocument, report: QaReport): void {
  doc.fillColor(COLORS.muted).font(FONT_BOLD).fontSize(7.5)
    .text('RELATÓRIO DE QA VISUAL', MARGIN, 40, { characterSpacing: 1.2 });
  doc.fillColor(COLORS.ink).font(FONT_BOLD).fontSize(27)
    .text(clean(report.task), MARGIN, 58, { width: CONTENT_WIDTH });
  doc.roundedRect(MARGIN, 130, CONTENT_WIDTH, 80, 8).fill(COLORS.paleGreen);
  doc.fillColor(COLORS.green).font(FONT_BOLD).fontSize(18)
    .text('Nenhum ajuste visual encontrado.', MARGIN + 20, 160, { width: CONTENT_WIDTH - 40, align: 'center' });
}

function addFooters(doc: PDFKit.PDFDocument): void {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const previousBottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.fillColor(COLORS.muted).font(FONT_REGULAR).fontSize(7.5)
      .text(`QA Visual | Página ${index + 1} de ${range.count}`, MARGIN, PAGE_HEIGHT - 22, {
        width: CONTENT_WIDTH, align: 'center', lineBreak: false
      });
    doc.page.margins.bottom = previousBottomMargin;
  }
}

export async function writePdfReport(reportDir: string, report: QaReport, filename = 'qa-visual-report.pdf'): Promise<string> {
  await ensureDir(reportDir);
  const output = path.join(reportDir, filename);
  const doc = new PDFDocument({
    size: 'A4', margin: MARGIN, bufferPages: true,
    info: { Title: `Relatório de QA Visual ${clean(report.task)}`, Author: 'QA Figma Cadastra' }
  });
  doc.registerFont(FONT_REGULAR, FONT_REGULAR_FILE);
  doc.registerFont(FONT_BOLD, FONT_BOLD_FILE);
  const stream = createWriteStream(output);
  doc.pipe(stream);

  let hasContent = false;
  let issueNumber = 0;
  for (const result of report.results) {
    const issues = issuesForResult(report, result);
    if (!issues.length) continue;
    const isMobile = result.viewport === 'mobile' || result.dimensions.width <= 480;
    const perPage = isMobile ? 2 : 3;
    const imageHeight = isMobile ? 225 : 115;
    for (let start = 0; start < issues.length; start += perPage) {
      if (hasContent) doc.addPage();
      hasContent = true;
      addSectionHeader(doc, report, result, issues.length, start > 0);
      for (const issue of issues.slice(start, start + perPage)) {
        issueNumber += 1;
        addIssueBlock(doc, issue, result, issueNumber, imageHeight);
      }
    }
  }

  if (!hasContent) addNoIssuesPage(doc, report);
  addFooters(doc);
  doc.end();
  await new Promise<void>((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
  return output;
}
