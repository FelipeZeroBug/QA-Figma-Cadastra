import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { QaConfig } from '../types/index.js';

const viewport = z.object({
  label: z.string(), width: z.number().positive(), height: z.number().positive(),
  deviceScaleFactor: z.number().positive(), isMobile: z.boolean().optional()
});

const schema = z.object({
  viewports: z.object({ desktop: viewport, tablet: viewport, mobile: viewport }),
  tolerances: z.object({
    positionPx: z.number().nonnegative(), dimensionPx: z.number().nonnegative(),
    spacingPx: z.number().nonnegative(), fontSizePx: z.number().nonnegative(),
    colorDistance: z.number().nonnegative(), pixelThreshold: z.number().min(0).max(1),
    maxPixelDiffRatio: z.number().min(0).max(1)
  }),
  timeouts: z.object({
    navigationMs: z.number().positive(), resourceMs: z.number().positive(),
    stabilizationMs: z.number().nonnegative(), codexMs: z.number().positive(),
    maxScrollSteps: z.number().int().positive()
  }),
  reportsDir: z.string().min(1),
  ignoredSelectors: z.array(z.string()),
  approval: z.object({ failOnCritical: z.boolean(), failOnHigh: z.boolean(), failOnMedium: z.boolean(), failOnLow: z.boolean() }),
  screenshots: z.object({ animations: z.enum(['disabled', 'allow']), caret: z.enum(['hide', 'initial']), fullPage: z.boolean() }),
  codex: z.object({ enabled: z.boolean(), command: z.string(), model: z.string().nullable() })
});

export async function loadConfig(root = process.cwd()): Promise<QaConfig> {
  const file = path.join(root, 'config', 'default.json');
  const parsed = JSON.parse(await readFile(file, 'utf8')) as unknown;
  return schema.parse(parsed) as QaConfig;
}
