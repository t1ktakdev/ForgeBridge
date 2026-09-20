import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FORGEBRIDGE_VERSION } from '../../src/version.js';

const PackageManifestSchema = z.object({
  name: z.string(),
  version: z.string(),
  private: z.boolean().optional(),
  license: z.string(),
  mcpName: z.string(),
  repository: z.object({ type: z.string(), url: z.string() }),
  publishConfig: z.object({ access: z.string() }),
  bin: z.record(z.string(), z.string()),
  engines: z.object({ node: z.string() }),
  files: z.array(z.string()),
});

const BuildConfigSchema = z.object({
  compilerOptions: z.object({ rootDir: z.string(), outDir: z.string() }),
  include: z.array(z.string()),
  exclude: z.array(z.string()),
});

const SbomSchema = z.object({
  bomFormat: z.string(),
  specVersion: z.string(),
  metadata: z.object({ component: z.object({ name: z.string(), version: z.string() }) }),
  components: z.array(z.object({ name: z.string() })),
});

describe('release package metadata', () => {
  it('keeps the package, CLI, and MCP version source consistent', async () => {
    const manifest = PackageManifestSchema.parse(
      JSON.parse(await readFile(path.resolve('package.json'), 'utf8')),
    );
    expect(manifest.name).toBe('forgebridge');
    expect(manifest.version).toBe(FORGEBRIDGE_VERSION);
    expect(manifest.private).toBeUndefined();
    expect(manifest.license).toBe('Apache-2.0');
    expect(manifest.mcpName).toBe('io.github.t1ktakdev/forgebridge');
    expect(manifest.repository.url).toBe('https://github.com/t1ktakdev/ForgeBridge.git');
    expect(manifest.publishConfig.access).toBe('public');
    expect(manifest.bin).toEqual({ forgebridge: './dist/cli.js' });
    expect(manifest.engines.node).toBe('>=22.0.0');
    expect(manifest.files).toContain('SBOM.cdx.json');
    expect(manifest.files).toContain('README.ru.md');
    expect(manifest.files).toContain('server.json');
    expect(manifest.files).toContain('docs');
    for (const script of [
      'scripts/configure-autostart-windows.ps1',
      'scripts/run-autostart-windows.ps1',
      'scripts/remove-autostart-windows.ps1',
    ]) {
      expect(manifest.files).toContain(script);
    }
  });

  it('uses a production-only TypeScript build', async () => {
    const configuration = BuildConfigSchema.parse(
      JSON.parse(await readFile(path.resolve('tsconfig.build.json'), 'utf8')),
    );
    expect(configuration.compilerOptions).toMatchObject({ rootDir: 'src', outDir: 'dist' });
    expect(configuration.include).toEqual(['src/**/*.ts']);
    expect(configuration.exclude).toContain('tests');
  });

  it('tracks a deterministic CycloneDX production dependency inventory', async () => {
    const sbom = SbomSchema.parse(
      JSON.parse(await readFile(path.resolve('SBOM.cdx.json'), 'utf8')),
    );
    expect(sbom).toMatchObject({
      bomFormat: 'CycloneDX',
      specVersion: '1.6',
      metadata: {
        component: { name: 'forgebridge', version: FORGEBRIDGE_VERSION },
      },
    });
    const names = new Set(sbom.components.map((component: { name: string }) => component.name));
    for (const name of ['@modelcontextprotocol/sdk', 'node-pty', 'playwright', 'zod']) {
      expect(names.has(name)).toBe(true);
    }
  });
});
