import process from 'node:process';
import chalk from 'chalk';
import { loadLocalEnv } from '../config/env.js';
import { loadConfig } from '../config/index.js';
import { findFrameCandidates, getFigmaNode, selectFrameForViewport } from '../figma/api.js';

async function main(): Promise<void> {
  const root = process.cwd();
  loadLocalEnv(root);
  const [figmaUrl = '', hint = ''] = process.argv.slice(2);
  if (!figmaUrl) {
    throw new Error('Informe a URL do Figma. Exemplo: npm run figma:check -- "https://www.figma.com/design/...?...node-id=..."');
  }
  console.log(chalk.cyan('Verificando acesso pela API oficial do Figma...'));
  const result = await getFigmaNode(figmaUrl);
  const config = await loadConfig(root);
  const frames = findFrameCandidates(result.node);
  console.log(chalk.green.bold('Acesso confirmado.'));
  console.log(`Arquivo: ${result.fileName}`);
  console.log(`Nó: ${result.node.name} (${result.parsed.nodeId})`);
  console.log(`Frames encontrados: ${frames.length}`);
  for (const viewportName of ['desktop', 'mobile'] as const) {
    const selected = selectFrameForViewport(result.node, config.viewports[viewportName], hint);
    const box = selected.absoluteBoundingBox!;
    console.log(`${config.viewports[viewportName].label} selecionado: ${selected.name} — ${Math.round(box.width)}×${Math.round(box.height)} — ${selected.id}`);
  }
  for (const frame of frames.slice(0, 20)) {
    console.log(`- ${frame.name} — ${Math.round(frame.width)}×${Math.round(frame.height)} — ${frame.id}`);
  }
  if (frames.length > 20) console.log(`... e mais ${frames.length - 20} frame(s).`);
}

main().catch((error) => {
  console.error(chalk.red(`Erro: ${error instanceof Error ? error.message : String(error)}`));
  process.exitCode = 1;
});
