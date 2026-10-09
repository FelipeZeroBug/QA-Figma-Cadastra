import path from 'node:path';
import sharp from 'sharp';
import open from 'open';
import { loadConfig } from '../config/index.js';
import { createVisualDiff } from '../visual-diff/index.js';
import { compareDeterministically } from '../comparator/index.js';
import { determineStatus, summarize, writeReport } from '../reporter/index.js';
import { writePdfReport } from '../reporter/pdf.js';
import { ensureDir } from '../utils/files.js';
import type { ComponentSnapshot, QaReport, ViewportResult } from '../types/index.js';

async function demoImage(file: string, color: string, shift = 0): Promise<void> {
  await sharp({ create: { width: 720, height: 450, channels: 4, background: '#f8fafc' } })
    .composite([
      { input: Buffer.from(`<svg width="620" height="110"><rect width="620" height="110" rx="14" fill="${color}"/><text x="28" y="65" fill="white" font-size="30" font-family="Arial">Visual QA Demo</text></svg>`), left: 50, top: 42 + shift },
      { input: Buffer.from(`<svg width="620" height="210"><rect width="620" height="210" rx="14" fill="#fff" stroke="#d0d5dd"/><circle cx="95" cy="90" r="45" fill="#e0e7ff"/><rect x="170" y="50" width="360" height="18" rx="9" fill="#98a2b3"/><rect x="170" y="88" width="290" height="14" rx="7" fill="#d0d5dd"/></svg>`), left: 50, top: 180 }
    ]).png().toFile(file);
}

async function main(): Promise<void> {
  const root = process.cwd();
  const config = await loadConfig(root);
  const reportDir = await ensureDir(path.join(root, config.reportsDir, 'Demo-QA'));
  const dir = await ensureDir(path.join(reportDir, 'desktop'));
  const screenshots = { figma: path.join(dir, 'figma.png'), development: path.join(dir, 'development.png'), sideBySide: path.join(dir, 'side-by-side.png'), diff: path.join(dir, 'diff.png') };
  await Promise.all([demoImage(screenshots.figma, '#4f46e5'), demoImage(screenshots.development, '#5850ec', 8)]);
  const pixelDiff = await createVisualDiff({ ...screenshots, width: 720, height: 450, threshold: config.tolerances.pixelThreshold });
  const figmaComponents: ComponentSnapshot[] = [{ id: 'f1', name: 'Hero Banner', order: 0, text: 'Visual QA Demo', rect: { x: 50, y: 42, width: 620, height: 110 }, certainty: 'MEASURED', styles: {}, children: 1 }];
  const developmentComponents: ComponentSnapshot[] = [{ id: 'd1', name: 'Hero Banner', order: 0, text: 'Visual QA Demo', rect: { x: 50, y: 50, width: 620, height: 110 }, certainty: 'MEASURED', styles: {}, children: 1 }];
  const demoConfig = { ...config, tolerances: { ...config.tolerances, maxPixelDiffRatio: 0.001 } };
  const deterministicIssues = compareDeterministically({ figma: figmaComponents, development: developmentComponents, pixelDiff, viewport: 'desktop', config: demoConfig });
  const result: ViewportResult = { viewport: 'desktop', dimensions: { label: 'Desktop Demo', width: 720, height: 450, deviceScaleFactor: 1 }, figmaComponents, developmentComponents, deterministicIssues, codexIssues: [], pixelDiff, referenceAvailable: true, intelligentAnalysisAvailable: false, intelligentAnalysisError: 'Modo demo: chamada ao Codex intencionalmente omitida.', screenshots };
  const issues = deterministicIssues;
  const report: QaReport = { task: 'Demo QA Visual', figmaUrl: 'https://www.figma.com/', developmentUrl: 'http://localhost/demo', createdAt: new Date().toISOString(), status: determineStatus(issues, demoConfig, [result]), results: [result], issues, summary: summarize([result]) };
  const file = await writeReport(reportDir, report);
  const pdf = await writePdfReport(reportDir, report);
  console.log(`Demo gerada com sucesso:\nHTML: ${file}\nPDF: ${pdf}`);
  if (process.env.QA_DEMO_OPEN === '1') await open(pdf);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
