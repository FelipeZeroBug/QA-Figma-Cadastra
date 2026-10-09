import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Issue, QaConfig, QaReport, Status, ViewportResult } from '../types/index.js';
import { ensureDir, relativeWebPath, writeJson } from '../utils/files.js';

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char] ?? char);
}

export function determineStatus(issues: Issue[], config: QaConfig, results: ViewportResult[] = []): Status {
  if (results.some((result) => !result.referenceAvailable)) return 'INCONCLUSIVO';
  const fail = issues.some((issue) =>
    (issue.severity === 'CRITICO' && config.approval.failOnCritical) ||
    (issue.severity === 'ALTO' && config.approval.failOnHigh) ||
    (issue.severity === 'MEDIO' && config.approval.failOnMedium) ||
    (issue.severity === 'BAIXO' && config.approval.failOnLow)
  );
  return fail ? 'REPROVADO' : 'APROVADO';
}

export function summarize(results: ViewportResult[]) {
  const issues = results.flatMap((result) => [...result.deterministicIssues, ...result.codexIssues]);
  return {
    components: results.reduce((total, result) => total + Math.max(result.figmaComponents.length, result.developmentComponents.length), 0),
    critical: issues.filter((issue) => issue.severity === 'CRITICO').length,
    high: issues.filter((issue) => issue.severity === 'ALTO').length,
    medium: issues.filter((issue) => issue.severity === 'MEDIO').length,
    low: issues.filter((issue) => issue.severity === 'BAIXO').length
  };
}

function issueCard(issue: Issue, reportDir: string): string {
  const evidence = issue.evidence?.development || issue.evidence?.figma || issue.evidence?.diff;
  return `<article class="issue severity-${issue.severity.toLowerCase()}">
    <div class="issue-head"><div><span class="pill">${escapeHtml(issue.viewport)}</span><h3>${escapeHtml(issue.component)}</h3></div><strong>${escapeHtml(issue.severity)}</strong></div>
    <div class="issue-grid">
      <div><small>Categoria</small><b>${escapeHtml(issue.category)}</b></div>
      <div><small>Propriedade</small><b>${escapeHtml(issue.property)}</b></div>
      <div><small>Figma</small><b>${escapeHtml(issue.expected)}</b></div>
      <div><small>Desenvolvimento</small><b>${escapeHtml(issue.actual)}</b></div>
      <div><small>Diferença</small><b>${escapeHtml(issue.difference)}</b></div>
      <div><small>Fonte</small><b>${escapeHtml(issue.source)}</b></div>
    </div>
    <p>${escapeHtml(issue.description)}</p><p class="recommendation"><b>Recomendação:</b> ${escapeHtml(issue.recommendation)}</p>
    ${evidence ? `<img class="evidence" src="${escapeHtml(relativeWebPath(reportDir, evidence))}" alt="Evidência de ${escapeHtml(issue.component)}">` : ''}
  </article>`;
}

function viewportSection(result: ViewportResult, reportDir: string): string {
  const allIssues = [...result.deterministicIssues, ...result.codexIssues];
  const label = `${result.dimensions.label} — ${result.dimensions.width}×${result.dimensions.height}`;
  const figma = relativeWebPath(reportDir, result.screenshots.figma);
  const dev = relativeWebPath(reportDir, result.screenshots.development);
  const diff = relativeWebPath(reportDir, result.screenshots.diff);
  return `<section class="viewport">
    <div class="section-title"><div><span class="eyebrow">VIEWPORT</span><h2>${escapeHtml(label)}</h2></div><span>${allIssues.length} divergência(s)</span></div>
    ${!result.referenceAvailable ? `<div class="warning"><b>Referência indisponível:</b> ${escapeHtml(result.referenceError ?? 'Não foi possível carregar o Figma.')} A comparação deste viewport é inconclusiva.</div>` : ''}
    ${result.referenceAvailable && !result.intelligentAnalysisAvailable ? `<div class="warning">Análise inteligente via Codex indisponível nesta execução${result.intelligentAnalysisError ? `: ${escapeHtml(result.intelligentAnalysisError)}` : '.'}</div>` : ''}
    <div class="comparison">
      <div class="compare-labels"><b>FIGMA</b><b>DESENVOLVIMENTO</b></div>
      <div class="slider" data-slider><img src="${escapeHtml(dev)}" alt="Desenvolvimento"><div class="overlay"><img src="${escapeHtml(figma)}" alt="Figma"></div><input type="range" min="0" max="100" value="50" aria-label="Comparar Figma e desenvolvimento"></div>
    </div>
    ${result.referenceAvailable ? `<details><summary>Pixel diff — ${(result.pixelDiff.ratio * 100).toFixed(2)}%</summary><img class="diff" src="${escapeHtml(diff)}" alt="Pixel diff"></details>` : ''}
    <div class="issues">${allIssues.length ? allIssues.map((issue) => issueCard(issue, reportDir)).join('') : '<div class="empty">Nenhuma divergência reportada.</div>'}</div>
  </section>`;
}

function render(report: QaReport, reportDir: string): string {
  const statusClass = report.status === 'APROVADO' ? 'approved' : report.status === 'INCONCLUSIVO' ? 'inconclusive' : 'failed';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>QA Visual — ${escapeHtml(report.task)}</title>
  <style>
  :root{--bg:#f4f6f8;--card:#fff;--ink:#111827;--muted:#667085;--line:#e4e7ec;--accent:#5b4cff;--bad:#d92d20;--ok:#079455;--warn:#dc6803}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,sans-serif}.shell{max-width:1240px;margin:auto;padding:40px 24px 80px}.hero{background:#111827;color:white;border-radius:24px;padding:36px;box-shadow:0 20px 50px #1018281c}.eyebrow{font-size:11px;letter-spacing:.14em;font-weight:800;color:#a4bcfd}.hero h1{font-size:36px;margin:6px 0}.meta{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:24px}.meta a{color:#c7d7fe;overflow-wrap:anywhere}.status{display:inline-flex;margin-top:22px;padding:8px 14px;border-radius:99px;font-weight:800}.status.approved{background:#d1fadf;color:#05603a}.status.failed{background:#fee4e2;color:#b42318}.status.inconclusive{background:#fef0c7;color:#93370d}.cards{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:20px 0}.card,.viewport{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:20px}.card small,.issue-grid small{display:block;color:var(--muted)}.card strong{font-size:28px}.section-title,.issue-head,.compare-labels{display:flex;align-items:center;justify-content:space-between;gap:16px}.section-title h2{margin:3px 0 0}.viewport{margin-top:18px}.comparison{margin-top:20px}.compare-labels{padding:0 2px 8px}.slider{position:relative;overflow:hidden;border-radius:12px;background:#e5e7eb;aspect-ratio:var(--ratio,16/10)}.slider>img,.overlay img{width:100%;height:100%;object-fit:fill;display:block}.overlay{position:absolute;inset:0 50% 0 0;overflow:hidden;border-right:2px solid white}.overlay img{width:200%;max-width:none}.slider input{position:absolute;inset:auto 16px 12px;width:calc(100% - 32px)}details{margin:14px 0}summary{cursor:pointer;font-weight:700}.diff,.evidence{display:block;max-width:100%;border-radius:12px;border:1px solid var(--line);margin-top:12px}.issues{display:grid;gap:12px}.issue{border:1px solid var(--line);border-left:5px solid var(--warn);border-radius:14px;padding:18px}.issue.severity-critico,.issue.severity-alto{border-left-color:var(--bad)}.issue h3{margin:4px 0}.issue-head>strong{font-size:12px;color:var(--bad)}.pill{font-size:11px;color:var(--muted)}.issue-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;background:#f9fafb;padding:12px;border-radius:10px}.issue-grid b{font-size:13px;overflow-wrap:anywhere}.recommendation{background:#f0f4ff;padding:10px;border-radius:8px}.warning{background:#fffaeb;color:#93370d;padding:12px;border-radius:10px;margin-top:16px}.empty{text-align:center;padding:30px;color:var(--muted)}footer{color:var(--muted);text-align:center;margin-top:28px}@media(max-width:760px){.cards{grid-template-columns:1fr 1fr}.meta,.issue-grid{grid-template-columns:1fr}.hero h1{font-size:28px}}
  </style></head><body><main class="shell"><header class="hero"><span class="eyebrow">QA VISUAL REPORT</span><h1>${escapeHtml(report.task)}</h1><div class="status ${statusClass}">${report.status}</div><div class="meta"><div><b>Figma</b><br><a href="${escapeHtml(report.figmaUrl)}">${escapeHtml(report.figmaUrl)}</a></div><div><b>Development</b><br><a href="${escapeHtml(report.developmentUrl)}">${escapeHtml(report.developmentUrl)}</a></div><div><b>Gerado em</b><br>${escapeHtml(new Date(report.createdAt).toLocaleString('pt-BR'))}</div><div><b>Frame</b><br>${escapeHtml(report.selectedFrame?.name ?? 'URL informada')}</div></div></header>
  <section class="cards"><div class="card"><small>COMPONENTES</small><strong>${report.summary.components}</strong></div><div class="card"><small>CRÍTICOS</small><strong>${report.summary.critical}</strong></div><div class="card"><small>ALTOS</small><strong>${report.summary.high}</strong></div><div class="card"><small>MÉDIOS</small><strong>${report.summary.medium}</strong></div><div class="card"><small>BAIXOS</small><strong>${report.summary.low}</strong></div></section>
  ${report.results.map((result) => viewportSection(result, reportDir)).join('')}<footer>Gerado localmente por Visual QA + Playwright + Codex CLI</footer></main>
  <script>document.querySelectorAll('[data-slider]').forEach(s=>{const o=s.querySelector('.overlay'),i=s.querySelector('input');i.addEventListener('input',()=>{o.style.right=(100-Number(i.value))+'%' ;o.querySelector('img').style.width=(10000/Number(i.value||1))+'%'})})</script></body></html>`;
}

export async function writeReport(reportDir: string, report: QaReport): Promise<string> {
  await ensureDir(reportDir);
  await writeJson(path.join(reportDir, 'data.json'), report);
  const file = path.join(reportDir, 'index.html');
  await writeFile(file, render(report, reportDir), 'utf8');
  return file;
}
