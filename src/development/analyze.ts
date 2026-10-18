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
    const semanticTags = new Set([
      'HEADER', 'FOOTER', 'NAV', 'MAIN', 'SECTION', 'ARTICLE', 'FORM',
      'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'A', 'BUTTON', 'LABEL', 'INPUT', 'TEXTAREA', 'SELECT', 'IMG'
    ]);
    const all = Array.from(document.body.querySelectorAll('*'));
    const roots = all.filter((el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (rect.width <= 1 || rect.height <= 1 || style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
      if (el.closest('[aria-hidden="true"], [hidden]')) return false;
      if (rect.right <= 0 || rect.left >= document.documentElement.scrollWidth) return false;
      const tag = el.tagName;
      if (semanticTags.has(tag)) return true;
      const role = el.getAttribute('role');
      if (role && /banner|navigation|main|contentinfo|region|heading|tab|tabpanel|progressbar/i.test(role)) return true;
      const classAndId = `${el.id} ${el.className}`;
      const largeVisualBlock = rect.width >= window.innerWidth * 0.7 && rect.height >= 120
        && /section|container|wrapper|hero|banner|content|e-con|elementor/i.test(classAndId);
      return largeVisualBlock;
    });
    const seen = new Set<string>();
    const unique = roots.filter((el) => {
      const rect = el.getBoundingClientRect();
      const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120);
      const key = `${el.tagName}|${Math.round(rect.x)}|${Math.round(rect.y + window.scrollY)}|${Math.round(rect.width)}|${Math.round(rect.height)}|${text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 1500);
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
      let measuredRect = rect;
      if (/^(H[1-6]|P|A|BUTTON|LABEL)$/i.test(el.tagName) && (el.textContent || '').trim()) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const textRect = range.getBoundingClientRect();
        if (textRect.width > 1 && textRect.height > 1) measuredRect = textRect;
      }
      const heading = el.querySelector('h1,h2,h3,[aria-label]');
      const ownText = (el.textContent || '').trim().replace(/\s+/g, ' ');
      const semanticName = el.tagName === 'HEADER' ? 'Header'
        : el.tagName === 'FOOTER' ? 'Footer'
          : el.tagName === 'NAV' ? `Navigation${el.getAttribute('aria-label') ? ` - ${el.getAttribute('aria-label')}` : ''}`
            : '';
      const rawName = semanticName || el.getAttribute('aria-label') || el.getAttribute('alt') || heading?.textContent
        || el.getAttribute('placeholder') || el.getAttribute('data-testid') || ownText || el.tagName;
      const styles: Record<string, { value: string; certainty: 'MEASURED' }> = {};
      for (const property of styleProperties) styles[property] = { value: style.getPropertyValue(property), certainty: 'MEASURED' };
      return {
        id: `dev-${order + 1}`,
        name: rawName.trim().replace(/\s+/g, ' ').slice(0, 100),
        tag: el.tagName.toLowerCase(), order, selector,
        text: ownText.slice(0, 500),
        rect: { x: measuredRect.x, y: measuredRect.y + window.scrollY, width: measuredRect.width, height: measuredRect.height },
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
