import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { createVisualDiff, imageExists } from '../src/visual-diff/index.js';

describe('createVisualDiff', () => {
  it('gera diff e side-by-side com dimensões normalizadas', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'visual-qa-'));
    const figma = path.join(dir, 'figma.png');
    const development = path.join(dir, 'dev.png');
    const diff = path.join(dir, 'diff.png');
    const sideBySide = path.join(dir, 'side.png');
    await sharp({ create: { width: 20, height: 20, channels: 4, background: '#ffffff' } }).png().toFile(figma);
    await sharp({ create: { width: 20, height: 20, channels: 4, background: '#000000' } }).png().toFile(development);
    const result = await createVisualDiff({ figma, development, diff, sideBySide, width: 20, height: 20, threshold: 0.1 });
    expect(result.ratio).toBe(1);
    expect(await imageExists(diff)).toBe(true);
    expect(await imageExists(sideBySide)).toBe(true);
  });
});
