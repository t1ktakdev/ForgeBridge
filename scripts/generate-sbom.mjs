import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputFile = path.join(repository, 'SBOM.cdx.json');

function pnpmInvocation(args) {
  if (process.env.npm_execpath?.toLowerCase().includes('pnpm')) {
    return [process.execPath, [process.env.npm_execpath, ...args]];
  }
  return ['pnpm', args];
}

function packageUrl(name, version) {
  const encodedName = name.startsWith('@')
    ? `%40${name.slice(1).split('/').map(encodeURIComponent).join('/')}`
    : encodeURIComponent(name);
  return `pkg:npm/${encodedName}@${encodeURIComponent(version)}`;
}

async function manifestDetails(directory) {
  try {
    const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    const licenses =
      typeof manifest.license === 'string' && manifest.license.length > 0
        ? [{ expression: manifest.license }]
        : undefined;
    return {
      ...(licenses ? { licenses } : {}),
      ...(typeof manifest.description === 'string'
        ? { description: manifest.description.slice(0, 4096) }
        : {}),
    };
  } catch {
    return {};
  }
}

const [pnpmCommand, pnpmArguments] = pnpmInvocation([
  'list',
  '--prod',
  '--json',
  '--depth',
  'Infinity',
]);
const listed = spawnSync(pnpmCommand, pnpmArguments, {
  cwd: repository,
  encoding: 'utf8',
  shell: false,
});
if (listed.status !== 0) throw new Error(listed.stderr || 'pnpm list failed');
const [root] = JSON.parse(listed.stdout);
if (!root?.name || !root?.version) throw new Error('pnpm list did not return the package root');

const components = new Map();
const edges = new Map();
async function visit(name, node) {
  if (!node?.version) return undefined;
  const reference = packageUrl(name, node.version);
  if (!components.has(reference)) {
    components.set(reference, {
      type: 'library',
      'bom-ref': reference,
      name,
      version: node.version,
      purl: reference,
      ...(node.path ? await manifestDetails(node.path) : {}),
      ...(typeof node.resolved === 'string'
        ? {
            externalReferences: [{ type: 'distribution', url: node.resolved }],
          }
        : {}),
    });
  }
  const children = [];
  for (const [childName, child] of Object.entries(node.dependencies ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const childReference = await visit(childName, child);
    if (childReference) children.push(childReference);
  }
  const existing = edges.get(reference) ?? new Set();
  for (const child of children) existing.add(child);
  edges.set(reference, existing);
  return reference;
}

const rootReference = packageUrl(root.name, root.version);
const rootDependencies = [];
for (const [name, dependency] of Object.entries(root.dependencies ?? {}).sort(([left], [right]) =>
  left.localeCompare(right),
)) {
  const reference = await visit(name, dependency);
  if (reference) rootDependencies.push(reference);
}

const sbom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  version: 1,
  metadata: {
    component: {
      type: 'application',
      'bom-ref': rootReference,
      name: root.name,
      version: root.version,
      purl: rootReference,
    },
    tools: { components: [{ type: 'application', name: 'ForgeBridge SBOM generator' }] },
  },
  components: [...components.values()].sort((left, right) =>
    left['bom-ref'].localeCompare(right['bom-ref']),
  ),
  dependencies: [
    { ref: rootReference, dependsOn: [...new Set(rootDependencies)].sort() },
    ...[...edges.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([reference, children]) => ({ ref: reference, dependsOn: [...children].sort() })),
  ],
};

const serialized = `${JSON.stringify(sbom, null, 2)}\n`;
if (process.argv.includes('--check')) {
  const existing = await readFile(outputFile, 'utf8').catch(() => '');
  if (existing !== serialized) {
    throw new Error('SBOM.cdx.json is not current; run pnpm run sbom:generate');
  }
} else {
  await writeFile(outputFile, serialized, 'utf8');
}
