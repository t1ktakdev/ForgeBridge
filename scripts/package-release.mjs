import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pnpmInvocation } from './pnpm-invocation.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(repository, 'release');
if (path.dirname(outputDirectory) !== repository || path.basename(outputDirectory) !== 'release') {
  throw new Error(`Refusing to replace unexpected release path: ${outputDirectory}`);
}
await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

const manifest = JSON.parse(await readFile(path.join(repository, 'package.json'), 'utf8'));
const artifactStem = manifest.name.replace(/^@/, '').replaceAll('/', '-');

const [pnpmCommand, pnpmArguments] = pnpmInvocation([
  'pack',
  '--out',
  path.join(outputDirectory, `${artifactStem}-%v.tgz`),
]);
const packed = spawnSync(pnpmCommand, pnpmArguments, {
  cwd: repository,
  encoding: 'utf8',
  shell: false,
  stdio: 'inherit',
});
if (packed.error) throw new Error('Could not start pnpm pack', { cause: packed.error });
if (packed.status !== 0) throw new Error(`pnpm pack failed with exit code ${packed.status}`);

const tarballs = (await readdir(outputDirectory)).filter((name) => name.endsWith('.tgz'));
if (tarballs.length !== 1)
  throw new Error(`Expected one package artifact, found ${tarballs.length}`);
const tarball = path.join(outputDirectory, tarballs[0]);
const digest = createHash('sha256')
  .update(await readFile(tarball))
  .digest('hex');
await writeFile(path.join(outputDirectory, 'SHA256SUMS'), `${digest}  ${tarballs[0]}\n`, 'utf8');
await copyFile(
  path.join(repository, 'SBOM.cdx.json'),
  path.join(outputDirectory, `${artifactStem}-${manifest.version}.sbom.cdx.json`),
);
process.stdout.write(`${JSON.stringify({ tarball, sha256: digest }, null, 2)}\n`);
