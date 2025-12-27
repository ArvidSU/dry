import { spawnSync } from 'child_process';
import path from 'path';

/**
 * Gets the current git commit hash for the given directory.
 * Returns null if the directory is not a git repository or git is not installed.
 */
export function getCommitHash(dirPath: string): string | null {
  try {
    const result = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: dirPath,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    if (result.status === 0 && result.stdout) {
      return result.stdout.trim();
    }
  } catch (error) {
    // Git not installed or other fatal error
  }
  return null;
}

