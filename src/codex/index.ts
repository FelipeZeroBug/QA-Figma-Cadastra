import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Issue, QaConfig, ViewportName } from '../types/index.js';
import { execFileResult, spawnWithInput } from '../utils/process.js';
import { writeJson } from '../utils/files.js';

const outputSchema = z.object({
  summary: z.object({ assessment: z.string(), confidence: z.number().min(0).max(1) }),
  issues: z.array(z.object({
    component: z.string(), viewport: z.string(), category: z.string(), property: z.string(),
    expected: z.string(), actual: z.string(), difference: z.string(),
    severity: z.enum(['CRITICO', 'ALTO', 'MEDIO', 'BAIXO']), description: z.string(),
    recommendation: z.string(), confidence: z.number().min(0).max(1)
  }))
});

export async function checkCodex(config: QaConfig): Promise<{ version: string; authenticated: boolean }> {
  const version = await execFileResult(config.codex.command, ['--version'], 10000).catch(() => null);
  if (!version || version.code !== 0) throw new Error('Codex CLI não encontrado. Verifique a instalação.');
  const status = await execFileResult(config.codex.command, ['login', 'status'], 10000);
  return { version: version.stdout.trim(), authenticated: status.code === 0 && /logged in/i.test(`${status.stdout} ${status.stderr}`) };
}

function qaPrompt(contextFile: string, viewport: ViewportName): string {
  return `Você é um QA Sênior especializado em validação visual pixel-perfect.
Analise o arquivo ${path.basename(contextFile)} e as três imagens anexadas (Figma, desenvolvimento e diff).
Compare componente por componente no viewport ${viewport}. Priorize sempre os valores MEASURED; nunca invente propriedades.
As imagens representam a página completa, do header ao footer. Percorra todas as seções da imagem, inclusive as que ficam abaixo da primeira dobra.
O Figma pode expor apenas dados INFERRED/UNAVAILABLE via canvas: deixe esperado/encontrado como indisponível em vez de fabricar números.
Identifique componentes ausentes/extras, ordem, dimensões, posicionamento, espaçamento, tipografia, cores, bordas, radius, sombras, imagens e responsividade.
Não reporte antialiasing isolado como defeito. Não duplique diferenças determinísticas já listadas.
Para cada problema informe todos os campos do schema. Retorne exclusivamente JSON válido no schema solicitado.`;
}

export async function analyzeWithCodex(options: {
  root: string; viewport: ViewportName; viewportDir: string; context: unknown;
  images: [string, string, string]; config: QaConfig;
}): Promise<{ issues: Issue[]; error?: string }> {
  const contextFile = path.join(options.viewportDir, 'validation-context.json');
  const outputFile = path.join(options.viewportDir, 'codex-result.json');
  await writeJson(contextFile, options.context);
  const args = [
    'exec', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '--color', 'never',
    '-C', options.viewportDir,
    '--output-schema', path.join(options.root, 'config', 'codex-output-schema.json'),
    '--output-last-message', outputFile,
    '-i', options.images[0], '-i', options.images[1], '-i', options.images[2], '-'
  ];
  if (options.config.codex.model) args.splice(1, 0, '--model', options.config.codex.model);
  const result = await spawnWithInput(options.config.codex.command, args, qaPrompt(contextFile, options.viewport), options.config.timeouts.codexMs);
  if (result.code !== 0) return { issues: [], error: result.stderr.trim() || `Codex encerrou com código ${result.code}.` };
  try {
    const parsed = outputSchema.parse(JSON.parse(await readFile(outputFile, 'utf8')));
    return { issues: parsed.issues.map((issue) => ({ ...issue, source: 'codex' as const })) };
  } catch (error) {
    return { issues: [], error: `JSON inválido retornado pelo Codex: ${error instanceof Error ? error.message : String(error)}` };
  }
}
