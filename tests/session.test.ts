import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { isLoginPage, settlePage } from '../src/browser/session.js';
import { extractComponents } from '../src/development/analyze.js';
import type { QaConfig } from '../src/types/index.js';

describe('settlePage', () => {
  it('não fica bloqueado em imagem que nunca finaliza', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent('<main style="height:2000px"><img id="pending"><h1>Teste</h1></main>');
      await page.evaluate(() => {
        Object.defineProperty(document.querySelector('#pending'), 'complete', { value: false });
      });
      const config = {
        timeouts: { navigationMs: 1000, resourceMs: 100, stabilizationMs: 0, codexMs: 1000, maxScrollSteps: 2 }
      } as QaConfig;
      const startedAt = Date.now();
      await settlePage(page, config);
      expect(Date.now() - startedAt).toBeLessThan(1000);
    } finally {
      await browser.close();
    }
  });

  it('extrai componentes dentro do contexto real do Chromium', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent('<header><h1>Cabeçalho</h1></header><main><section data-testid="hero"><h2>Hero</h2></section></main><footer>Rodapé</footer>');
      const components = await extractComponents(page);
      expect(components.map((component) => component.name)).toEqual(expect.arrayContaining(['Header', 'Cabeçalho', 'Hero', 'Footer']));
      expect(components.find((component) => component.selector === '[data-testid="hero"]')?.name).toBe('Hero');
      expect(components.every((component) => component.certainty === 'MEASURED')).toBe(true);
    } finally {
      await browser.close();
    }
  });

  it('não confunde um link Entrar no menu com uma página de autenticação', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent('<header><a href="/entrar">Entrar</a></header><main><h1>Home</h1></main>');
      expect(await isLoginPage(page)).toBe(false);
    } finally {
      await browser.close();
    }
  });

  it('identifica um formulário real de autenticação', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent('<main><h1>Entrar</h1><form><input type="email"><input type="password"></form></main>');
      expect(await isLoginPage(page)).toBe(true);
    } finally {
      await browser.close();
    }
  });
});
