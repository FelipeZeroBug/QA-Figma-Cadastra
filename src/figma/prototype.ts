import path from 'node:path';
import type { Page } from 'playwright';
import sharp from 'sharp';
import type { QaConfig, ViewportConfig } from '../types/index.js';

interface SampledImage {
  data: Buffer;
  width: number;
  height: number;
}

async function sampleImage(input: Buffer): Promise<SampledImage> {
  const { data, info } = await sharp(input)
    .resize({ width: 180 })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function estimateVerticalShift(previous: SampledImage, current: SampledImage, originalHeight: number): number {
  const height = Math.min(previous.height, current.height);
  const width = Math.min(previous.width, current.width);
  let bestShift = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  const minOverlap = Math.max(12, Math.floor(height * 0.18));
  const left = Math.floor(width * 0.04);
  const right = Math.floor(width * 0.9);

  for (let shift = 0; shift <= height - minOverlap; shift += 1) {
    const overlap = height - shift;
    let difference = 0;
    let samples = 0;
    for (let y = 0; y < overlap; y += 2) {
      const previousRow = (y + shift) * previous.width;
      const currentRow = y * current.width;
      for (let x = left; x < right; x += 3) {
        difference += Math.abs(previous.data[previousRow + x]! - current.data[currentRow + x]!);
        samples += 1;
      }
    }
    const score = samples ? difference / samples : Number.POSITIVE_INFINITY;
    if (score < bestScore) {
      bestScore = score;
      bestShift = shift;
    }
  }

  return Math.round(bestShift * originalHeight / height);
}

async function appendSlice(screenshot: Buffer, viewport: ViewportConfig, shift: number): Promise<Buffer> {
  return sharp(screenshot)
    .extract({ left: 0, top: viewport.height - shift, width: viewport.width, height: shift })
    .png()
    .toBuffer();
}

export async function captureScrollablePrototype(options: {
  page: Page;
  screenshot: string;
  viewport: ViewportConfig;
  config: QaConfig;
}): Promise<void> {
  const { page, viewport, config } = options;
  await page.getByTestId('cookie-dismiss-button').click({ timeout: 1500 }).catch(() => undefined);
  await page.mouse.move(Math.floor(viewport.width / 2), Math.floor(viewport.height / 2));
  await page.mouse.click(Math.floor(viewport.width / 2), Math.floor(viewport.height / 2));
  await page.keyboard.press('f');
  await page.waitForTimeout(Math.max(1800, config.timeouts.stabilizationMs));
  await page.mouse.wheel(0, -100_000);
  await page.waitForTimeout(900);

  const screenshotOptions = {
    animations: config.screenshots.animations,
    caret: config.screenshots.caret,
    scale: 'css' as const,
    type: 'png' as const
  };
  const first = await page.screenshot(screenshotOptions);
  const pieces: Buffer[] = [first];
  let previous = first;
  let previousSample = await sampleImage(previous);
  const requestedShift = Math.max(240, Math.floor(viewport.height * 0.72));

  for (let step = 0; step < config.timeouts.maxScrollSteps; step += 1) {
    await page.mouse.wheel(0, requestedShift);
    await page.waitForTimeout(650);
    const current = await page.screenshot(screenshotOptions);
    const currentSample = await sampleImage(current);
    const detectedShift = estimateVerticalShift(previousSample, currentSample, viewport.height);
    if (detectedShift < 6) break;
    const safeShift = Math.min(viewport.height, detectedShift);
    pieces.push(await appendSlice(current, viewport, safeShift));
    previous = current;
    previousSample = currentSample;
  }

  const heights = await Promise.all(pieces.map(async (piece) => (await sharp(piece).metadata()).height ?? 0));
  const totalHeight = heights.reduce((total, height) => total + height, 0);
  let top = 0;
  const composites = pieces.map((piece, index) => {
    const item = { input: piece, left: 0, top };
    top += heights[index]!;
    return item;
  });
  await sharp({
    create: { width: viewport.width, height: totalHeight, channels: 4, background: '#ffffff' }
  }).composite(composites).png().toFile(path.resolve(options.screenshot));
}
