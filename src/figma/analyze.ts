import path from 'node:path';
import type { Page } from 'playwright';
import type { ComponentSnapshot, FigmaFrame, QaConfig, ViewportConfig } from '../types/index.js';
import { isLoginPage, launchSession, settlePage } from '../browser/session.js';
import { captureScrollablePrototype } from './prototype.js';

export interface FigmaCaptureResult {
  components: ComponentSnapshot[];
  referenceAvailable: boolean;
  referenceError?: string;
}

function nodeIdFromUrl(value: string): string | null {
  try { return new URL(value).searchParams.get('node-id'); } catch { return null; }
}

export async function discoverFigmaFrames(page: Page, originalUrl: string): Promise<FigmaFrame[]> {
  const candidates = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('[role="treeitem"], a[href*="node-id"]'));
    return nodes.slice(0, 300).map((el) => ({
      name: (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120),
      href: el instanceof HTMLAnchorElement ? el.href : ''
    })).filter((item) => item.name.length > 1);
  }).catch(() => [] as Array<{ name: string; href: string }>);
  const seen = new Set<string>();
  const frames: FigmaFrame[] = [];
  const directNode = nodeIdFromUrl(originalUrl);
  if (directNode) {
    frames.push({ id: directNode, name: `Frame ${directNode}`, url: originalUrl, certainty: 'MEASURED' });
    seen.add(directNode);
  }
  for (const candidate of candidates) {
    const id = nodeIdFromUrl(candidate.href) || `layer-${frames.length + 1}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const url = candidate.href || originalUrl;
    frames.push({ id, name: candidate.name, url, certainty: candidate.href ? 'MEASURED' : 'INFERRED' });
  }
  return frames;
}

export async function extractFigmaComponents(page: Page): Promise<ComponentSnapshot[]> {
  const names = await page.evaluate(() => {
    const layers = Array.from(document.querySelectorAll('[role="treeitem"]'));
    return layers.map((el) => (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' '))
      .filter((value, index, values) => value.length > 1 && values.indexOf(value) === index)
      .slice(0, 150);
  }).catch(() => [] as string[]);
  return names.map((name, order) => ({
    id: `figma-${order + 1}`, name, order, text: name,
    rect: { x: 0, y: 0, width: 0, height: 0 }, certainty: 'INFERRED', styles: {}, children: 0
  }));
}

function visualFigmaUrl(input: string): string {
  const url = new URL(input);
  url.searchParams.set('hide-ui', '1');
  url.searchParams.set('hotspot-hints', '0');
  return url.toString();
}

function isBlocked(status: number, bodyText: string): boolean {
  return status >= 400 || /403\s+error|request could not be satisfied|access denied|request blocked/i.test(bodyText);
}

async function inspectAttempt(options: {
  root: string; url: string; viewport: ViewportConfig; config: QaConfig; headless: boolean; channel?: string;
}): Promise<{ frames: FigmaFrame[]; components: ComponentSnapshot[]; blocked: boolean }> {
  const context = await launchSession(options.root, 'figma', options.viewport, options.headless, options.channel);
  try {
    const page = context.pages()[0] ?? await context.newPage();
    const response = await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: options.config.timeouts.navigationMs });
    if (await isLoginPage(page)) throw new Error('Figma requer autenticação. Execute npm run auth:figma e tente novamente.');
    await settlePage(page, options.config);
    const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
    const blocked = isBlocked(response?.status() ?? 200, bodyText);
    return {
      frames: blocked ? [] : await discoverFigmaFrames(page, options.url),
      components: blocked ? [] : await extractFigmaComponents(page),
      blocked
    };
  } finally { await context.close(); }
}

export async function inspectFigma(options: {
  root: string; url: string; viewport: ViewportConfig; config: QaConfig; headless?: boolean;
}): Promise<{ frames: FigmaFrame[]; components: ComponentSnapshot[] }> {
  const first = await inspectAttempt({ ...options, headless: options.headless ?? true });
  if (!first.blocked || options.headless === false) return first;
  console.log('Figma bloqueou o navegador invisível. Repetindo no Google Chrome visível...');
  return inspectAttempt({ ...options, headless: false, channel: 'chrome' });
}

async function captureAttempt(options: {
  root: string; url: string; viewport: ViewportConfig; screenshot: string; config: QaConfig;
  headless: boolean; channel?: string;
}): Promise<FigmaCaptureResult & { blocked: boolean }> {
  const context = await launchSession(options.root, 'figma', options.viewport, options.headless, options.channel);
  try {
    const page = context.pages()[0] ?? await context.newPage();
    const response = await page.goto(visualFigmaUrl(options.url), { waitUntil: 'domcontentloaded', timeout: options.config.timeouts.navigationMs });
    if (await isLoginPage(page)) throw new Error('Figma requer autenticação. Execute npm run auth:figma e tente novamente.');
    await settlePage(page, options.config);
    const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
    const blocked = isBlocked(response?.status() ?? 200, bodyText);
    const components = blocked ? [] : await extractFigmaComponents(page);
    if (!blocked && new URL(options.url).pathname.startsWith('/proto/')) {
      await captureScrollablePrototype({ page, screenshot: options.screenshot, viewport: options.viewport, config: options.config });
    } else {
      await page.screenshot({
        path: path.resolve(options.screenshot), fullPage: false,
        animations: options.config.screenshots.animations, caret: options.config.screenshots.caret
      });
    }
    if (blocked) {
      return {
        components: [], referenceAvailable: false, blocked: true,
        referenceError: `A referência do Figma não pôde ser carregada (${response?.status() ?? 'resposta bloqueada'}).`
      };
    }
    return { components, referenceAvailable: true, blocked: false };
  } finally { await context.close(); }
}

export async function captureFigma(options: {
  root: string; url: string; viewport: ViewportConfig; screenshot: string; config: QaConfig;
}): Promise<FigmaCaptureResult> {
  const first = await captureAttempt({ ...options, headless: true });
  if (!first.blocked) return first;
  console.log('Figma retornou 403 no modo invisível. Repetindo a captura no Google Chrome visível...');
  return captureAttempt({ ...options, headless: false, channel: 'chrome' });
}
