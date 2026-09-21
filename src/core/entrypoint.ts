import { realpathSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// Node resolves ESM URLs through symlinks; argv retains the npm bin or temp-directory alias.
export function isMainModule(moduleUrl: string, entry = process.argv[1]): boolean {
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
