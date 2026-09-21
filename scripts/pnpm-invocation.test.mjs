import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pnpmInvocation } from './pnpm-invocation.mjs';

function fixture(platform, env, files, links = {}) {
  return {
    platform,
    env,
    execPath: '/runtime/node',
    exists: (file) => Object.hasOwn(files, file) || Object.hasOwn(links, file),
    realpath: (file) => links[file] ?? file,
    read: (file) => files[file],
  };
}
test('bare lifecycle pnpm is resolved on PATH, never passed to Node', () => {
  const options = fixture(
    'linux',
    { npm_execpath: 'pnpm', PATH: '/tools' },
    { '/tools/pnpm': 'ELF' },
  );
  assert.deepEqual(pnpmInvocation(['pack'], options), ['/tools/pnpm', ['pack']]);
});
test('absolute JavaScript lifecycle launchers use the current Node runtime', () => {
  const options = fixture('linux', { npm_execpath: '/tools/pnpm.cjs' }, { '/tools/pnpm.cjs': '' });
  assert.deepEqual(pnpmInvocation(['pack'], options), [
    '/runtime/node',
    ['/tools/pnpm.cjs', 'pack'],
  ]);
});
test('standalone executables are executed directly', () => {
  const options = fixture(
    'win32',
    { npm_execpath: 'C:\\tools\\pnpm.exe' },
    { 'C:\\tools\\pnpm.exe': 'MZ' },
  );
  assert.deepEqual(pnpmInvocation(['pack'], options), ['C:\\tools\\pnpm.exe', ['pack']]);
});
test('npm lifecycle resolves pnpm instead of running npm as pnpm', () => {
  const options = fixture(
    'darwin',
    { npm_execpath: '/npm/npm-cli.js', PATH: '/tools' },
    { '/tools/pnpm': '#!/usr/bin/env node\n' },
  );
  assert.deepEqual(pnpmInvocation(['pack'], options), ['/runtime/node', ['/tools/pnpm', 'pack']]);
});
test('direct invocation follows JS symlinks', () => {
  const options = fixture(
    'linux',
    { PATH: '/tools' },
    { '/lib/pnpm.cjs': '' },
    { '/tools/pnpm': '/lib/pnpm.cjs' },
  );
  assert.deepEqual(pnpmInvocation(['pack'], options), ['/runtime/node', ['/lib/pnpm.cjs', 'pack']]);
});
test('Windows npm shims and paths with spaces avoid shell quoting', () => {
  const script = 'C:\\Program Files\\tools\\node_modules\\pnpm\\bin\\pnpm.cjs';
  const options = fixture(
    'win32',
    { Path: 'C:\\Program Files\\tools' },
    {
      'C:\\Program Files\\tools\\pnpm.cmd': '',
      [script]: '',
    },
  );
  assert.deepEqual(pnpmInvocation(['pack', '--out', 'D:\\with spaces\\out.tgz'], options), [
    '/runtime/node',
    [script, 'pack', '--out', 'D:\\with spaces\\out.tgz'],
  ]);
});
test('Corepack Windows shims resolve their JavaScript entry point', () => {
  const script = 'C:\\tools\\node_modules\\corepack\\dist\\pnpm.js';
  const options = fixture(
    'win32',
    { PATH: 'C:\\tools' },
    { 'C:\\tools\\pnpm.cmd': '', [script]: '' },
  );
  assert.deepEqual(pnpmInvocation(['pack'], options), ['/runtime/node', [script, 'pack']]);
});
test('missing pnpm reports a recovery instruction', () => {
  assert.throws(() => pnpmInvocation([], fixture('linux', {}, {})), /ensure pnpm is on PATH/u);
});
