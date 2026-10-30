import path from 'node:path';
import process from 'node:process';
import { confirm, input, select } from '@inquirer/prompts';
import chalk from 'chalk';
import open from 'open';
import { loadConfig } from '../config/index.js';
import { figmaAccessToken, loadLocalEnv } from '../config/env.js';
import { runQa } from '../runner.js';
import type { FigmaFrame, ViewportName } from '../types/index.js';

function validUrl(value: string): true | string {
  try { new URL(value); return true; } catch { return 'Informe uma URL válida, incluindo https://'; }
}

async function main(): Promise<void> {
  const root = process.cwd();
  loadLocalEnv(root);
  const config = await loadConfig(root);
  console.log(chalk.bold.cyan('\n================================'));
  console.log(chalk.bold.cyan('       QA FIGMA CADASTRA'));
  console.log(chalk.bold.cyan('================================\n'));
  const task = await input({ message: 'Nome da tarefa:', validate: (value) => value.trim() ? true : 'Informe um nome.' });
  const developmentPageUrl = await input({ message: 'URL completa da página desenvolvida:', validate: validUrl });
  const selectedViewport = await select<ViewportName>({
    message: 'Selecione o viewport que deseja validar:',
    choices: (Object.entries(config.viewports) as Array<[ViewportName, (typeof config.viewports)[ViewportName]]>).map(([value, item]) => ({
      name: `${item.label} (${item.width}×${item.height})`, value
    }))
  });
  const viewports: ViewportName[] = [selectedViewport];
  const figmaUrls: Partial<Record<ViewportName, string>> = {};
  if (figmaAccessToken()) {
    const designUrl = await input({
      message: `URL da página do Figma que contém o frame ${config.viewports[selectedViewport].label}:`,
      validate: validUrl
    });
    figmaUrls[selectedViewport] = designUrl.trim();
  } else {
    figmaUrls[selectedViewport] = await input({
      message: `URL da prévia completa no Figma - ${config.viewports[selectedViewport].label}:`,
      validate: validUrl
    });
  }
  const parsedDevelopmentUrl = new URL(developmentPageUrl.trim());
  const workspaceUrl = parsedDevelopmentUrl.origin;
  const route = `${parsedDevelopmentUrl.pathname}${parsedDevelopmentUrl.search}` || '/';
  const figmaUrl = figmaUrls[selectedViewport]!;
  if (!await confirm({ message: 'Iniciar?', default: true })) return;
  const result = await runQa(root, {
    task: task.trim(), figmaUrl: figmaUrl.trim(), figmaUrls,
    workspaceUrl, route, viewports
  }, config, {
    progress: (step, total, message) => console.log(chalk.cyan(`[${step}/${total}]`), message),
    chooseFrame: async (frames: FigmaFrame[]) => {
      const choices = frames.slice(0, 50).map((frame) => ({ name: `${frame.name} (${frame.id})`, value: frame }));
      return select({ message: 'Frames encontrados — selecione a referência:', choices });
    }
  });
  const { summary } = result.report;
  console.log(chalk.bold('\nVALIDAÇÃO FINALIZADA\n'));
  console.log(`Componentes analisados: ${summary.components}`);
  console.log(`Crítico: ${summary.critical}\nAlto: ${summary.high}\nMédio: ${summary.medium}\nBaixo: ${summary.low}`);
  const status = result.report.status === 'APROVADO'
    ? chalk.green.bold('APROVADO')
    : result.report.status === 'INCONCLUSIVO'
      ? chalk.yellow.bold('INCONCLUSIVO')
      : chalk.red.bold('REPROVADO');
  console.log(`\nSTATUS: ${status}`);
  console.log(`\nRelatório HTML: ${path.relative(root, result.reportFile)}`);
  console.log(`Relatório PDF: ${path.relative(root, result.pdfFile)}`);
  if (await confirm({ message: 'Abrir relatório PDF agora?', default: true })) await open(result.pdfFile);
}

main().catch((error) => {
  console.error(chalk.red(`\nErro: ${error instanceof Error ? error.message : String(error)}`));
  process.exitCode = 1;
});
