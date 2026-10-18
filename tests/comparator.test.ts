import { describe, expect, it } from 'vitest';
import { compareDeterministically } from '../src/comparator/index.js';
import type { ComponentSnapshot, QaConfig } from '../src/types/index.js';

const config = {
  tolerances: { maxPixelDiffRatio: 0.02 }
} as QaConfig;

const component = (name: string, id: string): ComponentSnapshot => ({
  id, name, order: 0, text: name, rect: { x: 0, y: 0, width: 100, height: 20 }, certainty: 'MEASURED', styles: {}, children: 0
});

const textComponent = (name: string, id: string, source: 'figma' | 'development'): ComponentSnapshot => ({
  id, name, tag: source === 'figma' ? 'text' : 'h2', order: 0, text: name,
  rect: { x: 20, y: 100, width: source === 'figma' ? 220 : 250, height: 40 }, certainty: 'MEASURED',
  styles: {
    'font-family': { value: source === 'figma' ? 'Gantari' : 'Arial', certainty: 'MEASURED' },
    'font-size': { value: source === 'figma' ? '40px' : '32px', certainty: 'MEASURED' },
    color: { value: source === 'figma' ? 'rgba(10, 20, 30, 1)' : 'rgb(50, 60, 70)', certainty: 'MEASURED' }
  }, children: 0
});

describe('compareDeterministically', () => {
  it('detecta componente principal ausente', () => {
    const issues = compareDeterministically({
      figma: [component('Newsletter', 'f1')], development: [component('Footer', 'd1')],
      pixelDiff: { ratio: 0, differentPixels: 0, totalPixels: 100, width: 10, height: 10 },
      viewport: 'desktop', config
    });
    expect(issues.some((issue) => issue.property === 'presence' && issue.severity === 'ALTO')).toBe(true);
  });

  it('reporta pixel diff acima da tolerância', () => {
    const issues = compareDeterministically({
      figma: [], development: [], pixelDiff: { ratio: 0.1, differentPixels: 10, totalPixels: 100, width: 10, height: 10 },
      viewport: 'mobile', config
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.property).toBe('pixel-diff');
  });

  it('descreve os valores exatos de estilo por componente', () => {
    const issues = compareDeterministically({
      figma: [textComponent('Título principal', 'f1', 'figma')],
      development: [textComponent('Título principal', 'd1', 'development')],
      pixelDiff: { ratio: 0, differentPixels: 0, totalPixels: 100, width: 10, height: 10 },
      viewport: 'desktop',
      config: {
        ...config,
        tolerances: {
          positionPx: 2, dimensionPx: 2, spacingPx: 2, fontSizePx: 1,
          colorDistance: 4, pixelThreshold: 0.1, maxPixelDiffRatio: 0.02
        }
      }
    });
    expect(issues[0]?.description).toContain('fonte: Figma Gantari, desenvolvimento Arial');
    expect(issues[0]?.description).toContain('tamanho da fonte: Figma 40px, desenvolvimento 32px');
    expect(issues[0]?.description).toContain('cor: Figma rgba(10, 20, 30, 1), desenvolvimento rgb(50, 60, 70)');
  });
});
