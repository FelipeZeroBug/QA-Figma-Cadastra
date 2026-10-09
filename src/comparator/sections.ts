import path from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import sharp from 'sharp';
import type { ComponentSnapshot, Issue, QaConfig, ViewportName } from '../types/index.js';
import { ensureDir, taskSlug } from '../utils/files.js';

const GENERIC_NAME = /^(div|section|main|article)$/i;

function severityForRatio(ratio: number): Issue['severity'] {
  if (ratio >= 0.45) return 'ALTO';
  if (ratio >= 0.2) return 'MEDIO';
  return 'BAIXO';
}

export async function comparePageSections(options: {
  figmaScreenshot: string;
  developmentScreenshot: string;
  components: ComponentSnapshot[];
  viewport: ViewportName;
  viewportWidth: number;
  config: QaConfig;
  outputDir: string;
}): Promise<Issue[]> {
  await ensureDir(options.outputDir);
  const [figmaMetadata, developmentMetadata] = await Promise.all([
    sharp(options.figmaScreenshot).metadata(),
    sharp(options.developmentScreenshot).metadata()
  ]);
  const figmaHeight = figmaMetadata.height ?? 1;
  const developmentHeight = developmentMetadata.height ?? 1;
  const figmaWidth = figmaMetadata.width ?? options.viewportWidth;
  const developmentWidth = developmentMetadata.width ?? options.viewportWidth;
  const verticalScale = figmaHeight / developmentHeight;
  const minRatio = Math.max(0.08, options.config.tolerances.maxPixelDiffRatio);
  const sections = options.components.filter((component) =>
    !GENERIC_NAME.test(component.name) && component.rect.height >= 120 && component.rect.width >= options.viewportWidth * 0.75
  );
  const issues: Issue[] = [];

  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index]!;
    const developmentTop = Math.max(0, Math.floor(section.rect.y));
    const developmentSectionHeight = Math.min(
      developmentHeight - developmentTop,
      Math.max(1, Math.round(section.rect.height))
    );
    const figmaTop = Math.max(0, Math.round(section.rect.y * verticalScale));
    const figmaSectionHeight = Math.min(
      figmaHeight - figmaTop,
      Math.max(1, Math.round(section.rect.height * verticalScale))
    );
    if (developmentSectionHeight <= 0 || figmaSectionHeight <= 0) continue;

    const slug = `${String(index + 1).padStart(2, '0')}-${taskSlug(section.name).toLowerCase()}`;
    const figmaEvidence = path.join(options.outputDir, `${slug}-figma.png`);
    const developmentEvidence = path.join(options.outputDir, `${slug}-development.png`);
    const diffEvidence = path.join(options.outputDir, `${slug}-diff.png`);
    const targetHeight = Math.max(1, developmentSectionHeight);
    const [figmaBuffer, developmentBuffer] = await Promise.all([
      sharp(options.figmaScreenshot)
        .extract({ left: 0, top: figmaTop, width: figmaWidth, height: figmaSectionHeight })
        .resize({ width: options.viewportWidth, height: targetHeight, fit: 'fill' })
        .ensureAlpha().png().toBuffer(),
      sharp(options.developmentScreenshot)
        .extract({ left: 0, top: developmentTop, width: developmentWidth, height: developmentSectionHeight })
        .resize({ width: options.viewportWidth, height: targetHeight, fit: 'fill' })
        .ensureAlpha().png().toBuffer()
    ]);
    const figma = PNG.sync.read(figmaBuffer);
    const development = PNG.sync.read(developmentBuffer);
    const diff = new PNG({ width: options.viewportWidth, height: targetHeight });
    const differentPixels = pixelmatch(
      figma.data, development.data, diff.data, options.viewportWidth, targetHeight,
      { threshold: options.config.tolerances.pixelThreshold, includeAA: false, alpha: 0.65, diffColor: [255, 0, 80] }
    );
    const ratio = differentPixels / (options.viewportWidth * targetHeight);
    if (ratio <= minRatio) continue;

    await Promise.all([
      sharp(figmaBuffer).png().toFile(figmaEvidence),
      sharp(developmentBuffer).png().toFile(developmentEvidence),
      sharp(PNG.sync.write(diff)).png().toFile(diffEvidence)
    ]);
    const percentage = (ratio * 100).toFixed(2);
    issues.push({
      component: section.name,
      viewport: options.viewport,
      category: 'SECAO',
      property: 'fidelidade visual da seção',
      expected: `Seção correspondente à prévia completa do Figma, na mesma ordem visual (${section.name}).`,
      actual: `A área equivalente no desenvolvimento possui ${percentage}% de pixels divergentes.`,
      difference: `${differentPixels} pixels divergentes (${percentage}%).`,
      severity: severityForRatio(ratio),
      description: `A seção “${section.name}” apresenta diferenças visuais relevantes em relação à referência. O cálculo considera conjuntamente estrutura, imagens, dimensões, espaçamentos, cores e tipografia da região.`,
      recommendation: `Revisar a seção “${section.name}” usando as duas evidências lado a lado e ajustar primeiro estrutura e dimensões; depois conferir espaçamentos, tipografia, cores e imagens.`,
      confidence: 0.88,
      source: 'deterministic',
      evidence: { figma: figmaEvidence, development: developmentEvidence, diff: diffEvidence }
    });
  }
  return issues;
}
