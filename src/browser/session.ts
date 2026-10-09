import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import type { QaConfig, ViewportConfig } from '../types/index.js';
import { ensureDir } from '../utils/files.js';

export type SessionKind = 'figma' | 'workspace';

export async function launchSession(
  root: string,
  kind: SessionKind,
  viewport: ViewportConfig,
  headless = true,
  channel?: string
): Promise<BrowserContext> {
  const userDataDir = await ensureDir(path.join(root, '.auth', `${kind}-profile`));
  return chromium.launchPersistentContext(userDataDir, {
    headless,
    ...(channel ? { channel } : {}),
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
    isMobile: viewport.isMobile ?? false,
    locale: 'pt-BR',
    colorScheme: 'light',
    reducedMotion: 'reduce'
  });
}

export async function isLoginPage(page: Page): Promise<boolean> {
  const current = new URL(page.url());
  const hostname = current.hostname.toLowerCase();
  const pathSegments = current.pathname.toLowerCase().split('/').filter(Boolean);
  if (hostname === 'accounts.google.com' || hostname.startsWith('login.') || pathSegments.some((segment) =>
    ['login', 'signin', 'sign-in', 'auth', 'authenticate', 'oauth'].includes(segment)
  )) return true;

  const password = page.locator('input[type="password"]:visible').first();
  if (await password.isVisible({ timeout: 750 }).catch(() => false)) return true;

  const loginHeading = page.getByRole('heading', { name: /^(sign in|log in|entrar|fazer login)$/i }).first();
  const credentialForm = page.locator('form').filter({
    has: page.locator('input[type="email"], input[name*=email i], input[name*=user i]')
  }).first();
  const [headingVisible, formVisible] = await Promise.all([
    loginHeading.isVisible({ timeout: 750 }).catch(() => false),
    credentialForm.isVisible({ timeout: 750 }).catch(() => false)
  ]);
  return headingVisible && formVisible;
}

export async function settlePage(page: Page, config: QaConfig): Promise<void> {
  await page.waitForLoadState('domcontentloaded', { timeout: config.timeouts.navigationMs });
  await page.waitForLoadState('networkidle', { timeout: Math.min(15000, config.timeouts.navigationMs) }).catch(() => undefined);
  await page.evaluate(async ({ maxScrollSteps }) => {
    let steps = 0;
    let y = 0;
    while (steps < maxScrollSteps) {
      const max = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
      if (y >= max) break;
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 50));
      y += Math.max(400, window.innerHeight * 0.8);
      steps += 1;
    }
    window.scrollTo(0, 0);
  }, { maxScrollSteps: config.timeouts.maxScrollSteps }).catch(() => undefined);
  await page.evaluate(async ({ timeoutMs }) => {
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
    const resources = (async () => {
      await Promise.race([document.fonts.ready, timeout]);
      const pendingImages = Array.from(document.images).filter((image) => !image.complete);
      await Promise.race([
        Promise.all(pendingImages.map((image) => new Promise<void>((resolve) => {
          image.addEventListener('load', () => resolve(), { once: true });
          image.addEventListener('error', () => resolve(), { once: true });
        }))),
        timeout
      ]);
    })();
    await Promise.race([resources, timeout]);
  }, { timeoutMs: config.timeouts.resourceMs }).catch(() => undefined);
  await page.waitForTimeout(config.timeouts.stabilizationMs);
}

export async function maskDynamicElements(page: Page, selectors: string[]) {
  const masks = [];
  for (const selector of selectors) {
    const locator = page.locator(selector);
    if (await locator.count().catch(() => 0)) masks.push(locator);
  }
  return masks;
}
