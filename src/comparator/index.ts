import type { ComponentSnapshot, Issue, PixelDiffResult, QaConfig, ViewportName } from '../types/index.js';

const majorPattern = /header|cabeçalho|breadcrumb|banner|hero|categor|product|produto|grid|blog|newsletter|footer|rodapé|navigation|navegação/i;

function normalized(value: string): string[] {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((word) => word.length > 2);
}

function similarity(left: string, right: string): number {
  const a = new Set(normalized(left));
  const b = new Set(normalized(right));
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((word) => b.has(word)).length;
  return intersection / Math.max(a.size, b.size);
}

function textSimilarity(left: string, right: string): number {
  const a = normalized(left).join(' ');
  const b = normalized(right).join(' ');
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (Math.min(a.length, b.length) >= 8 && (a.includes(b) || b.includes(a))) {
    return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  }
  return similarity(a, b);
}

function styleValue(component: ComponentSnapshot, property: string): string | null {
  const value = component.styles[property]?.value;
  return value === undefined || value === null ? null : String(value).trim();
}

function numberValue(value: string | null): number | null {
  if (!value || value === 'normal') return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fontName(value: string): string {
  return value.split(',')[0]!.replace(/["']/g, '').trim().toLowerCase();
}

function colorChannels(value: string): number[] | null {
  const match = value.match(/rgba?\(([^)]+)\)/i);
  if (!match?.[1]) return null;
  const channels = match[1].split(',').map((part) => Number.parseFloat(part.trim()));
  return channels.length >= 3 && channels.every(Number.isFinite) ? channels : null;
}

function colorsDiffer(left: string, right: string, tolerance: number): boolean {
  const a = colorChannels(left);
  const b = colorChannels(right);
  if (!a || !b) return left.toLowerCase() !== right.toLowerCase();
  const alphaA = a[3] ?? 1;
  const alphaB = b[3] ?? 1;
  const distance = Math.sqrt((a[0]! - b[0]!) ** 2 + (a[1]! - b[1]!) ** 2 + (a[2]! - b[2]!) ** 2 + ((alphaA - alphaB) * 255) ** 2);
  return distance > tolerance;
}

interface ExactDifference { label: string; expected: string; actual: string }

function exactDifferences(design: ComponentSnapshot, development: ComponentSnapshot, config: QaConfig): ExactDifference[] {
  const differences: ExactDifference[] = [];
  const compareNumber = (property: string, label: string, tolerance: number): void => {
    const expected = styleValue(design, property);
    const actual = styleValue(development, property);
    const expectedNumber = numberValue(expected);
    const actualNumber = numberValue(actual);
    if (expected && actual && expectedNumber !== null && actualNumber !== null && Math.abs(expectedNumber - actualNumber) > tolerance) {
      differences.push({ label, expected, actual });
    }
  };
  const expectedFont = styleValue(design, 'font-family');
  const actualFont = styleValue(development, 'font-family');
  if (expectedFont && actualFont && fontName(expectedFont) !== fontName(actualFont)) {
    differences.push({ label: 'fonte', expected: expectedFont, actual: actualFont });
  }
  compareNumber('font-size', 'tamanho da fonte', config.tolerances.fontSizePx ?? 1);
  compareNumber('font-weight', 'peso da fonte', 25);
  compareNumber('line-height', 'altura da linha', config.tolerances.spacingPx ?? 2);
  compareNumber('letter-spacing', 'espaçamento entre letras', config.tolerances.spacingPx ?? 2);
  const expectedColor = styleValue(design, 'color');
  const actualColor = styleValue(development, 'color');
  if (expectedColor && actualColor && colorsDiffer(expectedColor, actualColor, config.tolerances.colorDistance ?? 4)) {
    differences.push({ label: 'cor', expected: expectedColor, actual: actualColor });
  }
  const align = (value: string | null): string | null => value?.toLowerCase().replace('start', 'left').replace('end', 'right') ?? null;
  const expectedAlign = align(styleValue(design, 'text-align'));
  const actualAlign = align(styleValue(development, 'text-align'));
  if (expectedAlign && actualAlign && expectedAlign !== actualAlign) {
    differences.push({ label: 'alinhamento', expected: expectedAlign, actual: actualAlign });
  }
  const widthTolerance = Math.max(config.tolerances.dimensionPx ?? 2, design.rect.width * 0.08);
  const heightTolerance = Math.max(config.tolerances.dimensionPx ?? 2, design.rect.height * 0.12);
  if (Math.abs(design.rect.width - development.rect.width) > widthTolerance) {
    differences.push({ label: 'largura', expected: `${Math.round(design.rect.width)}px`, actual: `${Math.round(development.rect.width)}px` });
  }
  if (Math.abs(design.rect.height - development.rect.height) > heightTolerance) {
    differences.push({ label: 'altura', expected: `${Math.round(design.rect.height)}px`, actual: `${Math.round(development.rect.height)}px` });
  }
  return differences;
}

function compareMeasuredText(options: {
  figma: ComponentSnapshot[]; development: ComponentSnapshot[]; viewport: ViewportName; config: QaConfig;
}): Issue[] {
  const designText = options.figma.filter((component) => component.tag === 'text' && normalized(component.text).join('').length >= 3);
  const developmentText = options.development.filter((component) => {
    const tag = component.tag ?? '';
    const reliableTextElement = /^(h[1-6]|p|label|input|textarea|select)$/i.test(tag)
      || (/^(a|button)$/i.test(tag) && component.children === 0);
    return reliableTextElement && normalized(component.text || component.name).join('').length >= 3;
  });
  const frameWidth = Math.max(1, options.figma[0]?.rect.width ?? 0, ...designText.map((component) => component.rect.width));
  const designBottom = Math.max(1, ...designText.map((component) => component.rect.y + component.rect.height));
  const developmentBottom = Math.max(1, ...developmentText.map((component) => component.rect.y + component.rect.height));
  const used = new Set<string>();
  const measuredIssues: Array<{ issue: Issue; y: number; differenceCount: number }> = [];
  for (const design of designText) {
    const match = developmentText
      .filter((candidate) => !used.has(candidate.id))
      .map((candidate) => {
        const textScore = Math.max(textSimilarity(design.text, candidate.text), textSimilarity(design.text, candidate.name));
        const positionScore = 1 - Math.min(1, Math.abs(design.rect.y / designBottom - candidate.rect.y / developmentBottom));
        return { candidate, textScore, score: textScore * 0.9 + positionScore * 0.1 };
      })
      .filter((entry) => entry.textScore >= 0.78)
      .sort((left, right) => right.score - left.score)[0];
    if (!match) continue;
    used.add(match.candidate.id);
    let differences = exactDifferences(design, match.candidate, options.config);
    if (design.rect.width >= frameWidth * 0.8) {
      differences = differences.filter((item) => !/largura|altura/.test(item.label));
    }
    if (!differences.length) continue;
    const component = (design.text || design.name).replace(/\s+/g, ' ').trim().slice(0, 90);
    const labels = differences.map((item) => item.label);
    const expected = differences.map((item) => `${item.label}: ${item.expected}`).join('; ');
    const actual = differences.map((item) => `${item.label}: ${item.actual}`).join('; ');
    const description = differences.map((item) => `${item.label}: Figma ${item.expected}, desenvolvimento ${item.actual}`).join('; ');
    const dimensionDifference = differences.some((item) => /largura|altura/.test(item.label));
    const issue: Issue = {
      component,
      viewport: options.viewport,
      category: differences.some((item) => /fonte|linha|letras|cor|alinhamento/.test(item.label)) ? 'TIPOGRAFIA' : 'DIMENSAO',
      property: labels.join(', '),
      expected,
      actual,
      difference: description,
      severity: differences.length >= 4 || dimensionDifference ? 'MEDIO' : 'BAIXO',
      description: `No componente “${component}”, ${description}.`,
      recommendation: `Ajustar ${labels.join(', ')} conforme os valores medidos no Figma.`,
      confidence: 0.96,
      source: 'deterministic'
    };
    measuredIssues.push({ issue, y: design.rect.y, differenceCount: differences.length });
  }
  if (measuredIssues.length <= 40) return measuredIssues.map((entry) => entry.issue);
  const selected: Issue[] = [];
  const bands = 10;
  for (let band = 0; band < bands; band += 1) {
    const start = band / bands;
    const end = (band + 1) / bands;
    const candidates = measuredIssues
      .filter((entry) => entry.y / designBottom >= start && (band === bands - 1 ? entry.y / designBottom <= end : entry.y / designBottom < end))
      .sort((left, right) => right.differenceCount - left.differenceCount || left.y - right.y)
      .slice(0, 2);
    selected.push(...candidates.map((entry) => entry.issue));
  }
  return selected;
}

export function compareDeterministically(options: {
  figma: ComponentSnapshot[];
  development: ComponentSnapshot[];
  pixelDiff: PixelDiffResult;
  viewport: ViewportName;
  config: QaConfig;
}): Issue[] {
  const issues: Issue[] = compareMeasuredText(options);
  const designComponents = options.figma.filter((item) => majorPattern.test(item.name)).slice(0, 40);
  for (const design of designComponents) {
    const match = options.development
      .map((candidate) => ({ candidate, score: Math.max(similarity(design.name, candidate.name), similarity(design.text, candidate.text)) }))
      .sort((a, b) => b.score - a.score)[0];
    if (!match || match.score < 0.34) {
      issues.push({
        component: design.name, viewport: options.viewport, category: 'EXISTENCIA', property: 'presence',
        expected: 'Presente no Figma', actual: 'Correspondência não localizada no DOM', difference: 'AUSENTE',
        severity: 'ALTO', description: `Nenhum componente de desenvolvimento corresponde com confiança a “${design.name}”.`,
        recommendation: 'Confirmar o mapeamento e implementar o componente caso esteja realmente ausente.',
        confidence: design.certainty === 'MEASURED' ? 0.9 : 0.65, source: 'deterministic'
      });
    }
  }
  if (options.pixelDiff.ratio > options.config.tolerances.maxPixelDiffRatio) {
    issues.push({
      component: 'Página', viewport: options.viewport, category: 'VISUAL', property: 'pixel-diff',
      expected: `Diferença ≤ ${(options.config.tolerances.maxPixelDiffRatio * 100).toFixed(2)}%`,
      actual: `${(options.pixelDiff.ratio * 100).toFixed(2)}%`,
      difference: `${options.pixelDiff.differentPixels} pixels`, severity: 'MEDIO',
      description: 'A comparação de pixels excedeu a tolerância configurada. O diff é evidência complementar e pode incluir diferenças do canvas/antialiasing.',
      recommendation: 'Revisar o diff visual e priorizar divergências confirmadas por medições ou inspeção dos componentes.',
      confidence: 0.8, source: 'deterministic'
    });
  }
  return issues;
}
