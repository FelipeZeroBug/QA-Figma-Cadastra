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

export function compareDeterministically(options: {
  figma: ComponentSnapshot[];
  development: ComponentSnapshot[];
  pixelDiff: PixelDiffResult;
  viewport: ViewportName;
  config: QaConfig;
}): Issue[] {
  const issues: Issue[] = [];
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
