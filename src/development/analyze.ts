import path from 'node:path';
import type { Page } from 'playwright';
import type { ComponentSnapshot, QaConfig, ViewportConfig } from '../types/index.js';
import { isLoginPage, launchSession, maskDynamicElements, settlePage } from '../browser/session.js';

const STYLE_PROPERTIES = [
  'display', 'position', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing',
  'text-transform', 'text-decoration-line', 'text-align', 'color', 'background-color', 'opacity',
  'border-width', 'border-style', 'border-color', 'border-radius', 'box-shadow',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'gap', 'align-items', 'justify-content'
];

export function buildDevelopmentUrl(base: string, route: string): string {
  const parsed = new URL(base);
  if ((!route || route === '/') && parsed.pathname !== '/') return parsed.toString();
  const normalized = base.endsWith('/') ? base : `${base}/`;
  return new URL(route.replace(/^\//, ''), normalized).toString();
}

export async function extractComponents(page: Page): Promise<ComponentSnapshot[]> {
  return page.evaluate(({ styleProperties }) => {
    const roots = Array.from(document.querySelectorAll(
      'header, footer, main > section, main > article, main > div, body > section, [role="banner"], [role="navigation"], [role="main"], [role="contentinfo"]'
    )).filter((el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 1 && rect.height > 1 && style.visibility !== 'hidden' && style.display !== 'none';
    });
    const unique = roots.filter((el, index) => roots.indexOf(el) === index);
    return unique.map((el, order) => {
      let selector = '';
      if (el.id) selector = `#${CSS.escape(el.id)}`;
      const testId = el.getAttribute('data-testid');
      if (!selector && testId) selector = `[data-testid="${CSS.escape(testId)}"]`;
      const parts: string[] = [];
      let current: Element | null = el;
      while (!selector && current && current !== document.body && parts.length < 4) {
        const parent: Element | null = current.parentElement;
        const tagName = current.tagName;
        const siblings = parent ? Array.from(parent.children).filter((sibling) => sibling.tagName === tagName) : [];
        const nth = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : '';
        parts.unshift(`${current.tagName.toLowerCase()}${nth}`);
        current = parent;
      }
      if (!selector) selector = parts.join(' > ');
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const heading = el.querySelector('h1,h2,h3,[aria-label]');
      const rawName = el.getAttribute('aria-label') || heading?.textContent || el.getAttribute('data-testid') || el.tagName;
      const styles: Record<string, { value: string; certainty: 'MEASURED' }> = {};
      for (const property of styleProperties) styles[property] = { value: style.getPropertyValue(property), certainty: 'MEASURED' };
      return {
        id: `dev-${order + 1}`,
        name: rawName.trim().replace(/\s+/g, ' ').slice(0, 100),
        tag: el.tagName.toLowerCase(), order, selector,
        text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 500),
        rect: { x: rect.x, y: rect.y + window.scrollY, width: rect.width, height: rect.height },
        certainty: 'MEASURED' as const, styles, children: el.children.length
      };
    });
  }, { styleProperties: STYLE_PROPERTIES });
}

export async function analyzeDevelopment(options: {
  root: string; url: string; viewport: ViewportConfig; screenshot: string; config: QaConfig;
}): Promise<ComponentSnapshot[]> {
  const context = await launchSession(options.root, 'workspace', options.viewport, true);
  try {
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: options.config.timeouts.navigationMs });
    if (await isLoginPage(page)) {
      throw new Error('Workspace requer autenticação. Execute npm run auth:ws e tente novamente.');
    }
    await settlePage(page, options.config);
    const components = await extractComponents(page);
    const mask = await maskDynamicElements(page, options.config.ignoredSelectors);
    await page.screenshot({
      path: path.resolve(options.screenshot), fullPage: true,
      animations: options.config.screenshots.animations, caret: options.config.screenshots.caret, mask
    });
    return components;
  } finally {
    await context.close();
  }
}
