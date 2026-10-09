import { describe, expect, it } from 'vitest';
import { compareDeterministically } from '../src/comparator/index.js';
import type { ComponentSnapshot, QaConfig } from '../src/types/index.js';

const config = {
  tolerances: { maxPixelDiffRatio: 0.02 }
} as QaConfig;

const component = (name: string, id: string): ComponentSnapshot => ({
  id, name, order: 0, text: name, rect: { x: 0, y: 0, width: 100, height: 20 }, certainty: 'MEASURED', styles: {}, children: 0
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
});
