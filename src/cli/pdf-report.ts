import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import type { QaReport } from '../types/index.js';
import { writePdfReport } from '../reporter/pdf.js';
import { summarize } from '../reporter/index.js';

async function main(): Promise<void> {
  const source = path.resolve(process.argv[2] ?? 'reports/Home/data.json');
  const report = JSON.parse(await readFile(source, 'utf8')) as QaReport;
  for (const result of report.results) {
    if (typeof result.referenceAvailable !== 'boolean') {
      const unavailable = [...result.deterministicIssues, ...result.codexIssues].some((issue) =>
        /referência indisponível|referencia indisponivel|403 error|request could not be satisfied/i.test(`${issue.category} ${issue.description} ${issue.actual}`)
      );
      result.referenceAvailable = !unavailable;
      if (unavailable) result.referenceError = 'A captura do Figma contém uma resposta CloudFront 403.';
    }
    if (!result.referenceAvailable) {
      result.deterministicIssues = result.deterministicIssues.filter((issue) => issue.property !== 'pixel-diff');
    }
  }
  report.issues = report.results.flatMap((result) => [...result.deterministicIssues, ...result.codexIssues]);
  report.summary = summarize(report.results);
  if (report.results.some((result) => !result.referenceAvailable)) report.status = 'INCONCLUSIVO';
  const outputArg = process.argv[3];
  const outputDir = outputArg ? path.dirname(path.resolve(outputArg)) : path.dirname(source);
  const filename = outputArg ? path.basename(outputArg) : 'qa-visual-report.pdf';
  const output = await writePdfReport(outputDir, report, filename);
  console.log(`PDF gerado: ${output}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
