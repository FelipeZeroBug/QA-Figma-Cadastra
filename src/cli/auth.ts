import process from 'node:process';
import chalk from 'chalk';
import { authenticate } from '../auth/index.js';
import { loadConfig } from '../config/index.js';

const target = process.argv[2];
if (target !== 'figma' && target !== 'workspace') {
  console.error('Uso: tsx src/cli/auth.ts <figma|workspace>');
  process.exitCode = 1;
} else {
  const root = process.cwd();
  loadConfig(root).then((config) => authenticate(root, target, config)).catch((error) => {
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  });
}
