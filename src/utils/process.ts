import { execFile, spawn } from 'node:child_process';

export interface ProcessResult { stdout: string; stderr: string; code: number }

export function execFileResult(command: string, args: string[], timeout: number): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout, maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && !('code' in error)) return reject(error);
      const code = error && typeof error.code === 'number' ? error.code : 0;
      resolve({ stdout: String(stdout), stderr: String(stderr), code });
    });
  });
}

export function spawnWithInput(command: string, args: string[], input: string, timeout: number): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeout);
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: timedOut ? `${stderr}\nTempo limite de ${timeout}ms excedido.`.trim() : stderr, code: timedOut ? 124 : code ?? 1 });
    });
    child.stdin.end(input);
  });
}
