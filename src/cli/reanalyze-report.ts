import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import type { Issue, QaReport } from '../types/index.js';
import { loadConfig } from '../config/index.js';
import { loadLocalEnv } from '../config/env.js';
import { analyzeDevelopment } from '../development/analyze.js';
import { createVisualDiff } from '../visual-diff/index.js';
import { compareDeterministically } from '../comparator/index.js';
import { comparePageSections } from '../comparator/sections.js';
import { createIssueEvidence } from '../evidence/index.js';
import { determineStatus, summarize, writeReport } from '../reporter/index.js';
import { writePdfReport } from '../reporter/pdf.js';

async function main(): Promise<void> {
  const root = process.cwd();
  loadLocalEnv(root);
  const source = path.resolve(process.argv[2] ?? 'reports/teste/data.json');
  const reportDir = path.dirname(source);
  const report = JSON.parse(await readFile(source, 'utf8')) as QaReport;
  const config = await loadConfig(root);

  for (const result of report.results) {
    const viewport = config.viewports[result.viewport];
    const figmaRoot = result.figmaComponents[0];
    const referenceWidth = figmaRoot?.rect.width ?? 0;
    const incompatible = !figmaRoot || Math.abs(referenceWidth - viewport.width) / viewport.width > 0.25;
    if (incompatible) {
      const message = figmaRoot
        ? `O frame salvo possui ${Math.round(referenceWidth)}px e não corresponde ao viewport ${viewport.label} (${viewport.width}px). Use a URL da página do Figma que contém todos os frames.`
        : 'A referência do Figma não contém componentes medidos.';
      const issue: Issue = {
        component: 'Referência Figma', viewport: result.viewport, category: 'REFERENCIA', property: 'viewport',
        expected: `${viewport.label} com aproximadamente ${viewport.width}px`, actual: message,
        difference: 'Referência incompatível', severity: 'CRITICO', description: message,
        recommendation: 'Executar novamente o QA usando a URL da página do Figma, não a URL de um frame isolado.',
        confidence: 1, source: 'deterministic'
      };
      result.referenceAvailable = false;
      result.referenceError = message;
      result.deterministicIssues = [issue];
      result.codexIssues = [];
      result.intelligentAnalysisAvailable = false;
      result.intelligentAnalysisError = message;
      continue;
    }

    const developmentComponents = await analyzeDevelopment({
      root, url: report.developmentUrl, viewport, screenshot: result.screenshots.development, config
    });
    const pixelDiff = await createVisualDiff({
      figma: result.screenshots.figma,
      development: result.screenshots.development,
      diff: result.screenshots.diff,
      sideBySide: result.screenshots.sideBySide,
      width: viewport.width,
      height: viewport.height,
      threshold: config.tolerances.pixelThreshold
    });
    const base = compareDeterministically({
      figma: result.figmaComponents, development: developmentComponents, pixelDiff,
      viewport: result.viewport, config
    });
    const sections = await comparePageSections({
      figmaScreenshot: result.screenshots.figma,
      developmentScreenshot: result.screenshots.development,
      components: developmentComponents,
      viewport: result.viewport,
      viewportWidth: viewport.width,
      config,
      outputDir: path.join(reportDir, result.viewport, 'sections')
    });
    const specific = base.filter((issue) => issue.property !== 'pixel-diff');
    const issues = specific.length ? specific : sections.length ? sections : base;
    await createIssueEvidence({
      issues,
      components: developmentComponents,
      figmaComponents: result.figmaComponents,
      developmentScreenshot: result.screenshots.development,
      figmaScreenshot: result.screenshots.figma,
      diffScreenshot: result.screenshots.diff,
      issuesDir: path.join(reportDir, 'issues', result.viewport),
      viewportHeight: viewport.height,
      viewportWidth: viewport.width
    });
    result.developmentComponents = developmentComponents;
    result.pixelDiff = pixelDiff;
    result.referenceAvailable = true;
    delete result.referenceError;
    result.deterministicIssues = issues;
    result.codexIssues = [];
    result.intelligentAnalysisAvailable = false;
    result.intelligentAnalysisError = 'Reanálise determinística baseada nos valores medidos do Figma e do DOM.';
  }

  report.createdAt = new Date().toISOString();
  report.issues = report.results.flatMap((result) => [...result.deterministicIssues, ...result.codexIssues]);
  report.summary = summarize(report.results);
  report.status = determineStatus(report.issues, config, report.results);
  await writeReport(reportDir, report);
  const pdf = await writePdfReport(reportDir, report);
  console.log(`Relatório reanalisado: ${pdf}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
