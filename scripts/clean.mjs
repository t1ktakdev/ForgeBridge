import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(repository, 'dist');
if (path.dirname(output) !== repository || path.basename(output) !== 'dist') {
  throw new Error(`Refusing to clean unexpected path: ${output}`);
}
await rm(output, { recursive: true, force: true });
