import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { writePdfReport } from '../src/reporter/pdf.js';
import type { Issue, QaReport } from '../src/types/index.js';

describe('writePdfReport', () => {
  it('gera um PDF com resumo, problema e evidências', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'visual-qa-pdf-'));
    const figma = path.join(dir, 'figma.png');
    const development = path.join(dir, 'development.png');
    const diff = path.join(dir, 'diff.png');
    const sideBySide = path.join(dir, 'side-by-side.png');
    await Promise.all([
      sharp({ create: { width: 200, height: 120, channels: 4, background: '#e0e7ff' } }).png().toFile(figma),
      sharp({ create: { width: 200, height: 120, channels: 4, background: '#fee2e2' } }).png().toFile(development),
      sharp({ create: { width: 200, height: 120, channels: 4, background: '#fef3c7' } }).png().toFile(diff),
      sharp({ create: { width: 400, height: 120, channels: 4, background: '#f8fafc' } }).png().toFile(sideBySide)
    ]);

    const issue: Issue = {
      component: 'Hero', viewport: 'desktop', category: 'LAYOUT', property: 'posição',
      expected: 'Alinhado ao centro', actual: 'Deslocado 16px', difference: '16px', severity: 'ALTO',
      description: 'O componente está fora da posição esperada.', recommendation: 'Centralizar o componente.',
      confidence: 1, source: 'deterministic'
    };
    const report: QaReport = {
      task: 'Teste PDF', figmaUrl: 'https://figma.example/teste', developmentUrl: 'https://example.test',
      createdAt: '2026-09-27T12:00:00.000Z', status: 'REPROVADO', issues: [issue],
      summary: { components: 1, critical: 0, high: 1, medium: 0, low: 0 },
      results: [{
        viewport: 'desktop', dimensions: { label: 'Desktop', width: 1440, height: 900, deviceScaleFactor: 1 },
        figmaComponents: [], developmentComponents: [], deterministicIssues: [issue], codexIssues: [],
        pixelDiff: { differentPixels: 10, totalPixels: 100, ratio: 0.1, width: 200, height: 120 },
        referenceAvailable: true, intelligentAnalysisAvailable: true,
        screenshots: { figma, development, diff, sideBySide }
      }]
    };

    const output = await writePdfReport(dir, report);
    const pdf = await readFile(output);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(10_000);
  });
});
