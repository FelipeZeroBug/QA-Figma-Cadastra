import { readFile, writeFile } from 'node:fs/promises';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import sharp from 'sharp';
import type { PixelDiffResult } from '../types/index.js';

async function scaledHeight(file: string, width: number): Promise<number> {
  const metadata = await sharp(file).metadata();
  if (!metadata.width || !metadata.height) return 1;
  return Math.max(1, Math.round(metadata.height * width / metadata.width));
}

async function normalizedPng(file: string, width: number, height: number): Promise<Buffer> {
  const resized = await sharp(file).resize({ width }).ensureAlpha().png().toBuffer();
  const metadata = await sharp(resized).metadata();
  const currentHeight = metadata.height ?? height;
  if (currentHeight >= height) return sharp(resized).extract({ left: 0, top: 0, width, height }).png().toBuffer();
  return sharp(resized).extend({ bottom: height - currentHeight, background: '#ffffff' }).png().toBuffer();
}

export async function createVisualDiff(options: {
  figma: string; development: string; diff: string; sideBySide: string;
  width: number; height: number; threshold: number;
}): Promise<PixelDiffResult> {
  const heights = await Promise.all([
    scaledHeight(options.figma, options.width),
    scaledHeight(options.development, options.width)
  ]);
  const normalizedHeight = Math.max(options.height, ...heights);
  const [figmaBuffer, devBuffer] = await Promise.all([
    normalizedPng(options.figma, options.width, normalizedHeight),
    normalizedPng(options.development, options.width, normalizedHeight)
  ]);
  const figma = PNG.sync.read(figmaBuffer);
  const development = PNG.sync.read(devBuffer);
  const diff = new PNG({ width: options.width, height: normalizedHeight });
  const differentPixels = pixelmatch(
    figma.data, development.data, diff.data, options.width, normalizedHeight,
    { threshold: options.threshold, includeAA: false, alpha: 0.65, diffColor: [255, 0, 80] }
  );
  await writeFile(options.diff, PNG.sync.write(diff));
  await sharp({
    create: { width: options.width * 2, height: normalizedHeight, channels: 4, background: '#ffffff' }
  }).composite([{ input: figmaBuffer, left: 0, top: 0 }, { input: devBuffer, left: options.width, top: 0 }])
    .png().toFile(options.sideBySide);
  return {
    differentPixels,
    totalPixels: options.width * normalizedHeight,
    ratio: differentPixels / (options.width * normalizedHeight),
    width: options.width,
    height: normalizedHeight
  };
}

export async function imageExists(file: string): Promise<boolean> {
  return readFile(file).then(() => true).catch(() => false);
}
