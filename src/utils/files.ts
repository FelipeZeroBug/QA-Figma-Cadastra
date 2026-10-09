import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import slugify from 'slugify';

export async function ensureDir(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  return dir;
}

export function taskSlug(value: string): string {
  return slugify(value, { lower: false, strict: true, trim: true }) || 'visual-qa';
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(file));
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function relativeWebPath(fromDir: string, file: string): string {
  return path.relative(fromDir, file).split(path.sep).join('/');
}
