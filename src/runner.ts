import path from 'node:path';
import sharp from 'sharp';
import type { FigmaFrame, QaConfig, QaReport, QaRequest, ViewportResult } from './types/index.js';
import { checkCodex, analyzeWithCodex } from './codex/index.js';
import { inspectFigma, captureFigma } from './figma/analyze.js';
import { analyzeDevelopment, buildDevelopmentUrl } from './development/analyze.js';
import { createVisualDiff } from './visual-diff/index.js';
import { compareDeterministically } from './comparator/index.js';
import { comparePageSections } from './comparator/sections.js';
import { determineStatus, summarize, writeReport } from './reporter/index.js';
import { writePdfReport } from './reporter/pdf.js';
import { createIssueEvidence } from './evidence/index.js';
import { ensureDir, taskSlug } from './utils/files.js';

interface RunnerHooks {
  progress?: (step: number, total: number, message: string) => void;
  chooseFrame?: (frames: FigmaFrame[]) => Promise<FigmaFrame>;
}

function dedupeIssues<T extends { component: string; viewport: string; category: string; property: string }>(issues: T[]): T[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.viewport}|${issue.component}|${issue.category}|${issue.property}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function frameForViewport(frames: FigmaFrame[], selected: FigmaFrame, viewport: QaRequest['viewports'][number]): FigmaFrame | null {
  const pattern = viewport === 'desktop' ? /desktop|desk|web/i : viewport === 'mobile' ? /mobile|mob|iphone|celular/i : /tablet|ipad/i;
  if (pattern.test(selected.name)) return selected;
  const named = frames.find((frame) => pattern.test(frame.name));
  return named ?? (viewport === 'tablet' ? null : selected);
}

async function unavailableImage(file: string, width: number, height: number, message: string): Promise<void> {
  const safe = message.replace(/[&<>]/g, '');
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#f8fafc"/><rect x="24" y="24" width="${Math.max(1, width - 48)}" height="${Math.max(1, height - 48)}" rx="16" fill="#fffaeb" stroke="#fedf89"/><text x="50%" y="50%" text-anchor="middle" fill="#93370d" font-size="20" font-family="Arial">${safe}</text></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(file);
}

export async function runQa(root: string, request: QaRequest, config: QaConfig, hooks: RunnerHooks = {}) {
  const total = 7;
  hooks.progress?.(1, total, 'Verificando Codex CLI');
  const codexState = config.codex.enabled ? await checkCodex(config) : { version: 'desativado', authenticated: false };
  if (config.codex.enabled && !codexState.authenticated) {
    throw new Error('Codex CLI instalado, mas não autenticado. Execute codex login e tente novamente.');
  }

  hooks.progress?.(2, total, 'Validando autenticação');
  const explicitReferences = request.viewports.every((viewport) => Boolean(request.figmaUrls?.[viewport]));
  const inspection = explicitReferences
    ? { frames: [] as FigmaFrame[], components: [] }
    : await inspectFigma({ root, url: request.figmaUrl, viewport: config.viewports.desktop, config });
  let selectedFrame: FigmaFrame = inspection.frames[0] ?? {
    id: 'url', name: 'Frame da URL informada', url: request.figmaUrl, certainty: 'INFERRED'
  };
  if (inspection.frames.length > 1 && hooks.chooseFrame) selectedFrame = await hooks.chooseFrame(inspection.frames);

  const reportDir = await ensureDir(path.resolve(root, config.reportsDir, taskSlug(request.task)));
  const developmentUrl = buildDevelopmentUrl(request.workspaceUrl, request.route);
  const results: ViewportResult[] = [];

  for (const viewportName of request.viewports) {
    const viewport = config.viewports[viewportName];
    const viewportDir = await ensureDir(path.join(reportDir, viewportName));
    const screenshots = {
      figma: path.join(viewportDir, 'figma.png'),
      development: path.join(viewportDir, 'development.png'),
      sideBySide: path.join(viewportDir, 'side-by-side.png'),
      diff: path.join(viewportDir, 'diff.png')
    };

    hooks.progress?.(3, total, `Analisando Figma — ${viewport.label}`);
    const explicitUrl = request.figmaUrls?.[viewportName];
    const viewportFrame = explicitUrl
      ? { id: new URL(explicitUrl).searchParams.get('node-id') ?? viewportName, name: `${viewport.label} - prévia completa`, url: explicitUrl, certainty: 'MEASURED' as const }
      : frameForViewport(inspection.frames, selectedFrame, viewportName);
    let figmaComponents = inspection.components;
    let referenceAvailable = Boolean(viewportFrame);
    let referenceError: string | undefined;
    if (viewportFrame) {
      const capture = await captureFigma({ root, url: viewportFrame.url, viewport, screenshot: screenshots.figma, config });
      referenceAvailable = capture.referenceAvailable;
      referenceError = capture.referenceError;
      figmaComponents = capture.components.length ? capture.components : inspection.components;
    } else {
      await unavailableImage(screenshots.figma, viewport.width, viewport.height, 'Referência específica de tablet não encontrada no Figma.');
      figmaComponents = [];
      referenceError = 'Referência específica de tablet não encontrada no Figma.';
    }

    hooks.progress?.(4, total, `Analisando desenvolvimento — ${viewport.label}`);
    const developmentComponents = await analyzeDevelopment({ root, url: developmentUrl, viewport, screenshot: screenshots.development, config });

    hooks.progress?.(5, total, `Comparando componentes — ${viewport.label}`);
    const pixelDiff = referenceAvailable ? await createVisualDiff({
      figma: screenshots.figma, development: screenshots.development, diff: screenshots.diff,
      sideBySide: screenshots.sideBySide, width: viewport.width, height: viewport.height,
      threshold: config.tolerances.pixelThreshold
    }) : { differentPixels: 0, totalPixels: viewport.width * viewport.height, ratio: 0, width: viewport.width, height: viewport.height };
    if (!referenceAvailable) {
      await Promise.all([
        unavailableImage(screenshots.diff, viewport.width, viewport.height, 'Pixel diff indisponível sem referência válida do Figma.'),
        unavailableImage(screenshots.sideBySide, viewport.width * 2, viewport.height, 'Comparação indisponível sem referência válida do Figma.')
      ]);
    }
    const baseDeterministicIssues = referenceAvailable ? compareDeterministically({ figma: figmaComponents, development: developmentComponents, pixelDiff, viewport: viewportName, config }) : [{
      component: 'Referência Figma', viewport: viewportName, category: 'REFERENCIA', property: 'disponibilidade',
      expected: 'Frame do Figma carregado', actual: referenceError ?? 'Referência indisponível', difference: 'UNAVAILABLE', severity: 'CRITICO' as const,
      description: 'A validação visual não pôde ser concluída porque a referência do Figma não foi carregada corretamente.',
      recommendation: 'Abra novamente a sessão do Figma, confirme o acesso ao frame e execute a validação outra vez.',
      confidence: 1, source: 'deterministic' as const
    }];
    const sectionIssues = referenceAvailable ? await comparePageSections({
      figmaScreenshot: screenshots.figma,
      developmentScreenshot: screenshots.development,
      components: developmentComponents,
      viewport: viewportName,
      viewportWidth: viewport.width,
      config,
      outputDir: path.join(viewportDir, 'sections')
    }) : [];
    const deterministicIssues = sectionIssues.length
      ? [...baseDeterministicIssues.filter((issue) => issue.property !== 'pixel-diff'), ...sectionIssues]
      : baseDeterministicIssues;

    hooks.progress?.(6, total, `Executando análise via Codex — ${viewport.label}`);
    let codexIssues: ViewportResult['codexIssues'] = [];
    let intelligentAnalysisAvailable = false;
    let intelligentAnalysisError: string | undefined;
    const codexImageSupported = pixelDiff.height <= viewport.height * 4;
    if (config.codex.enabled && referenceAvailable && codexImageSupported) {
      const analysis = await analyzeWithCodex({
        root, viewport: viewportName, viewportDir,
        context: {
          task: request.task, viewport: viewportName, dimensions: viewport,
          figmaComponents, developmentComponents, deterministicDifferences: deterministicIssues, pixelDiff,
          certaintyRule: 'MEASURED > INFERRED > UNAVAILABLE'
        },
        images: [screenshots.figma, screenshots.development, screenshots.diff], config
      });
      codexIssues = analysis.issues;
      intelligentAnalysisAvailable = !analysis.error;
      intelligentAnalysisError = analysis.error;
    } else {
      intelligentAnalysisError = !referenceAvailable
        ? referenceError ?? 'Referência do Figma indisponível.'
        : !config.codex.enabled
          ? 'Codex desativado na configuração.'
          : 'Página longa analisada por seções determinísticas para preservar a resolução das evidências.';
    }
    const merged = dedupeIssues([...deterministicIssues, ...codexIssues]);
    const deterministicKeys = new Set(deterministicIssues.map((item) => `${item.viewport}|${item.component}|${item.category}|${item.property}`.toLowerCase()));
    const finalDeterministic = merged.filter((item) => deterministicKeys.has(`${item.viewport}|${item.component}|${item.category}|${item.property}`.toLowerCase()));
    const finalCodex = merged.filter((item) => !deterministicKeys.has(`${item.viewport}|${item.component}|${item.category}|${item.property}`.toLowerCase()));
    await createIssueEvidence({
      issues: merged, components: developmentComponents, developmentScreenshot: screenshots.development,
      figmaScreenshot: screenshots.figma, diffScreenshot: screenshots.diff,
      issuesDir: path.join(reportDir, 'issues', viewportName), viewportHeight: viewport.height, viewportWidth: viewport.width
    });
    const baseResult = {
      viewport: viewportName, dimensions: viewport, figmaComponents, developmentComponents,
      deterministicIssues: finalDeterministic, codexIssues: finalCodex, pixelDiff,
      referenceAvailable, intelligentAnalysisAvailable, screenshots
    };
    results.push({
      ...baseResult,
      ...(referenceError ? { referenceError } : {}),
      ...(intelligentAnalysisError ? { intelligentAnalysisError } : {})
    });
  }

  hooks.progress?.(7, total, 'Gerando relatório');
  const issues = results.flatMap((result) => [...result.deterministicIssues, ...result.codexIssues]);
  const partial = {
    task: request.task, figmaUrl: request.figmaUrl, ...(request.figmaUrls ? { figmaUrls: request.figmaUrls } : {}),
    developmentUrl, createdAt: new Date().toISOString(), selectedFrame, results, issues
  };
  const report: QaReport = { ...partial, summary: summarize(results), status: determineStatus(issues, config, results) };
  const reportFile = await writeReport(reportDir, report);
  const pdfFile = await writePdfReport(reportDir, report);
  return { report, reportFile, pdfFile, codexVersion: codexState.version };
}
