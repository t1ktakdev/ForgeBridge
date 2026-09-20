import process from 'node:process';
import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';
import console from 'node:console';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { ForgeBridgeAgent } from '../dist/agent.js';
import { defaultConfig } from '../dist/core/config.js';
import { createForgeBridgeMcpServer } from '../dist/mcp/server.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const base = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-benchmark-'));
const root = path.join(base, 'project with spaces');
const state = path.join(base, 'state');
await mkdir(root);
await mkdir(path.join(root, 'src'));
await mkdir(path.join(root, 'tests'));
await writeFile(
  path.join(root, 'package.json'),
  JSON.stringify({
    name: 'benchmark-fixture',
    version: '1.0.0',
    engines: { node: '>=22' },
    packageManager: 'pnpm@11.22.0',
    scripts: { test: 'node --test', lint: 'node --check src/main.mjs', typecheck: 'tsc --noEmit' },
    dependencies: { react: '19.0.0' },
    devDependencies: { typescript: '6.0.3', vitest: '5.0.0' },
  }),
);
await writeFile(path.join(root, 'src', 'main.mjs'), 'export const answer = 42;\n');
await writeFile(path.join(root, 'tests', 'main.test.mjs'), 'export const fixture = true;\n');
await writeFile(path.join(root, 'tsconfig.json'), '{}');
await writeFile(path.join(root, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
await promisify(execFile)('git', ['init'], { cwd: root, windowsHide: true });
const started = performance.now();
const agent = await ForgeBridgeAgent.create(defaultConfig(root), state);
const server = createForgeBridgeMcpServer(agent);
const client = new Client({ name: 'local-benchmark', version: '1' });
const [a, b] = InMemoryTransport.createLinkedPair();
await server.connect(b);
await client.connect(a);
const startupMs = performance.now() - started;

function summarize(samples) {
  const warm = samples.slice(1).sort((x, y) => x - y);
  return {
    firstMs: samples[0],
    medianMs: (warm[4] + warm[5]) / 2,
    p90Ms: warm[8],
    maxMs: Math.max(...samples),
    samplesMs: samples,
  };
}

async function call(name, args) {
  const response = await client.callTool({ name, arguments: args });
  if (response.isError) throw new Error(`${name}: ${JSON.stringify(response)}`);
  return response;
}

async function benchmarkScenario(steps) {
  const samples = [];
  let responseBytes = 0;
  for (let i = 0; i < 11; i++) {
    const start = performance.now();
    let bytes = 0;
    for (const [name, args] of steps) {
      const response = await call(name, args);
      bytes += Buffer.byteLength(JSON.stringify(response.structuredContent));
    }
    samples.push(performance.now() - start);
    responseBytes = bytes;
  }
  return { callCount: steps.length, responseBytes, ...summarize(samples) };
}

try {
  const names = new Set((await client.listTools()).tools.map((t) => t.name));
  const cases = [
    ['permissions_status', {}],
    ['fs_read', { operation: 'read', path: path.join(root, 'package.json') }],
    ['git_read', { operation: 'status', repository: root }],
    ['system_info', {}],
    ['project_inspect', { workingDirectory: root }],
    ['project_scripts', { workingDirectory: root }],
  ];
  const results = {
    label: process.argv[2] ?? 'unlabelled',
    platform: process.platform,
    osRelease: os.release(),
    node: process.version,
    transport: 'in-memory MCP with real disk/audit/Git',
    sampleCount: 11,
    startupMs,
    tools: {},
    scenarios: {},
  };
  for (const [name, args] of cases) {
    if (!names.has(name)) continue;
    const samples = [];
    let bytes = 0;
    for (let i = 0; i < 11; i++) {
      const start = performance.now();
      const response = await call(name, args);
      samples.push(performance.now() - start);
      bytes = Buffer.byteLength(JSON.stringify(response.structuredContent));
    }
    results.tools[name] = { responseBytes: bytes, ...summarize(samples) };
  }

  // Same final build, two equivalent discovery strategies. This measures MCP/tool execution only;
  // it deliberately excludes model reasoning and remote network latency.
  const legacySteps = [
    ['permissions_status', { maxItems: 8 }],
    ['system_info', {}],
    ['fs_read', { operation: 'read', path: path.join(root, 'package.json') }],
    ['fs_read', { operation: 'tree', path: root, depth: 2, maxEntries: 200 }],
    ['git_read', { operation: 'status', repository: root }],
  ];
  const semanticSteps = [['project_inspect', { workingDirectory: root }]];
  results.scenarios.legacyMultiCallDiscovery = await benchmarkScenario(legacySteps);
  results.scenarios.semanticProjectInspect = await benchmarkScenario(semanticSteps);
  results.scenarios.comparison = {
    callCountReduction:
      results.scenarios.legacyMultiCallDiscovery.callCount -
      results.scenarios.semanticProjectInspect.callCount,
    medianSpeedup:
      results.scenarios.legacyMultiCallDiscovery.medianMs /
      results.scenarios.semanticProjectInspect.medianMs,
    note: 'Proxy before/after on the same final build: legacy five-call discovery versus one semantic project_inspect. Remote/model latency excluded.',
  };

  const output = process.argv[3];
  if (output) await writeFile(output, JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify(results, null, 2));
} finally {
  await client.close();
  await server.close();
  await agent.close({ cancelJobs: true });
  await rm(base, { recursive: true, force: true });
}
