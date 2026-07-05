import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';

interface ProcessResult {
  stdout: string;
  stderr: string;
}

@Injectable()
export class VideoMediaProcessRunner {
  run(
    command: string,
    args: string[],
    timeoutMs: number,
  ): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let settled = false;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          child.kill('SIGKILL');
          reject(new Error(`${command} timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
      child.on('error', (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(error);
        }
      });
      child.on('close', (code) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        const stdout = Buffer.concat(stdoutChunks).toString('utf8');
        const stderr = Buffer.concat(stderrChunks).toString('utf8');

        if (code !== 0) {
          reject(new Error(stderr || `${command} exited with code ${code}`));
          return;
        }

        resolve({ stdout, stderr });
      });
    });
  }
}
