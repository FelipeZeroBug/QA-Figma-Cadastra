import process from 'node:process';
import path from 'node:path';

export function loadLocalEnv(root = process.cwd()): void {
  for (const name of ['.env.local', '.env']) {
    try {
      process.loadEnvFile(path.join(root, name));
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw error;
    }
  }
}

export function figmaAccessToken(): string | null {
  const value = process.env.FIGMA_ACCESS_TOKEN?.trim();
  return value || null;
}
