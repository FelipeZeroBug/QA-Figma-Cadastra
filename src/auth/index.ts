import { confirm } from '@inquirer/prompts';
import type { QaConfig } from '../types/index.js';
import { launchSession, type SessionKind } from '../browser/session.js';

export async function authenticate(root: string, kind: SessionKind, config: QaConfig): Promise<void> {
  const viewport = config.viewports.desktop;
  const context = await launchSession(root, kind, viewport, false, kind === 'figma' ? 'chrome' : undefined);
  const pages = context.pages();
  const page = pages[0] ?? await context.newPage();
  const destination = kind === 'figma' ? 'https://www.figma.com/' : 'https://accounts.google.com/';
  await page.goto(destination, { waitUntil: 'domcontentloaded', timeout: config.timeouts.navigationMs });
  console.log(`\nNavegador aberto para autenticação de ${kind === 'figma' ? 'Figma' : 'Workspace'}.`);
  console.log('Faça login manualmente. Nenhuma credencial será lida ou exibida por esta ferramenta.\n');
  await confirm({ message: 'Login concluído e a página de destino está acessível?', default: true });
  await context.close();
  console.log('Sessão persistente salva localmente em .auth/.');
}
