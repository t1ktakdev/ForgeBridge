import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it } from 'vitest';
import { ForgeBridgeAgent } from '../../src/agent.js';
import { defaultConfig } from '../../src/core/config.js';
import { LocalTokenStore } from '../../src/core/local-token.js';
import { LocalHttpTransportServer } from '../../src/transports/http.js';

const execFileAsync = promisify(execFile);

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function eventually(check: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('Timed out waiting for fixture server');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('ForgeBridge development workflow', () => {
  let agent: ForgeBridgeAgent | undefined;
  let client: Client | undefined;
  let http: LocalHttpTransportServer | undefined;

  afterEach(async () => {
    await client?.close().catch(() => undefined);
    await http?.close();
    await agent?.close({ cancelJobs: true });
  });

  it('inspects, patches, tests, serves, browses, diffs, commits, and audits', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-workflow-root-'));
    const state = await mkdtemp(path.join(os.tmpdir(), 'forgebridge-workflow-state-'));
    const pageFile = path.join(root, 'page.txt');
    const testFile = path.join(root, 'page.test.mjs');
    const readmeFile = path.join(root, 'README.md');
    await writeFile(pageFile, 'BROKEN\n');
    await writeFile(
      path.join(root, 'server.mjs'),
      `import http from 'node:http'; import fs from 'node:fs';\nconst port=Number(process.argv[2]); http.createServer((_q,r)=>{r.setHeader('content-type','text/html');r.end('<main><h1>'+fs.readFileSync('page.txt','utf8').trim()+'</h1></main>')}).listen(port,'127.0.0.1',()=>console.log('ready:'+port));\n`,
    );
    await writeFile(
      testFile,
      `import assert from 'node:assert/strict'; import fs from 'node:fs'; import test from 'node:test';\nconst expected = 'BROKEN\\n';\ntest('page',()=>assert.equal(fs.readFileSync('page.txt','utf8'),expected));\n`,
    );
    await writeFile(readmeFile, '# Fixture\n');
    await execFileAsync('git', ['init'], { cwd: root });
    await execFileAsync('git', ['config', 'user.name', 'ForgeBridge Test'], { cwd: root });
    await execFileAsync('git', ['config', 'user.email', 'forgebridge@example.invalid'], {
      cwd: root,
    });
    await execFileAsync('git', ['add', '.'], { cwd: root });
    await execFileAsync('git', ['commit', '-m', 'initial fixture'], { cwd: root });

    agent = await ForgeBridgeAgent.create(defaultConfig(root), state);
    const tokens = new LocalTokenStore(state);
    const token = await tokens.loadOrCreate();
    http = new LocalHttpTransportServer({
      agent,
      tokens,
      host: '127.0.0.1',
      port: 0,
      allowedOrigins: [],
      maxRequestBytes: agent.config.limits.maxRequestBytes,
      maxConcurrentRequests: agent.config.limits.maxConcurrentRequests,
    });
    const address = await http.listen();
    client = new Client({ name: 'workflow-client', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(address.mcpUrl), {
        requestInit: { headers: { Authorization: `Bearer ${token.token}` } },
      }),
    );
    const csrfResponse = await fetch(address.mcpUrl.replace('/mcp', '/control/csrf'), {
      headers: { Authorization: `Bearer ${token.token}` },
    });
    const csrf = (await csrfResponse.json()) as { csrfToken: string };

    const call = async (name: string, argumentsValue: Record<string, unknown>) => {
      const result = await client?.callTool({ name, arguments: argumentsValue });
      if (!result) throw new Error('MCP client is unavailable');
      if (result.isError) throw new Error(JSON.stringify(result.structuredContent));
      return (result.structuredContent as { data: unknown }).data;
    };
    const callApproved = async (name: string, argumentsValue: Record<string, unknown>) => {
      const first = await client?.callTool({ name, arguments: argumentsValue });
      if (!first) throw new Error('MCP client is unavailable');
      if (!first.isError) return (first.structuredContent as { data: unknown }).data;
      const details = first.structuredContent as {
        error?: { code?: string; details?: { approval?: { id: string } } };
      };
      expect(details.error?.code).toBe('approval_required');
      const approvalId = details.error?.details?.approval?.id;
      if (!approvalId) throw new Error('Approval ID missing');
      const response = await fetch(address.mcpUrl.replace('/mcp', '/control/action'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token.token}`,
          'Content-Type': 'application/json',
          'X-ForgeBridge-CSRF': csrf.csrfToken,
        },
        body: JSON.stringify({ action: 'approval', approvalId, response: 'once' }),
      });
      expect(response.status).toBe(200);
      return call(name, { ...argumentsValue, approvalIds: [approvalId] });
    };

    const tree = (await call('fs_read', { operation: 'tree', path: root })) as {
      entries: { name: string }[];
    };
    expect(tree.entries.some((entry) => entry.name === 'server.mjs')).toBe(true);
    const search = (await call('fs_read', {
      operation: 'search_content',
      path: root,
      query: 'BROKEN',
      glob: '*.txt',
    })) as { matches: unknown[] };
    expect(search.matches.length).toBeGreaterThan(0);

    const readme = (await call('fs_read', { operation: 'read', path: readmeFile })) as {
      sha256: string;
    };
    await call('fs_write', {
      operation: 'patch',
      path: readmeFile,
      expectedSha256: readme.sha256,
      unifiedDiff: '@@ -1 +1,2 @@\n # Fixture\n+Validated through ForgeBridge.\n',
    });
    const firstTest = (await call('terminal', {
      operation: 'run',
      command: 'node --test page.test.mjs',
      workingDirectory: root,
    })) as { exitCode: number };
    expect(firstTest.exitCode).toBe(0);

    const port = await unusedPort();
    const job = (await call('jobs', {
      operation: 'create',
      type: 'dev-server',
      command: `node server.mjs ${port}`,
      workingDirectory: root,
    })) as { id: string };
    const url = `http://127.0.0.1:${port}`;
    await eventually(async () => {
      try {
        return (await fetch(url)).ok;
      } catch {
        return false;
      }
    });

    const browser = (await call('browser_read', { operation: 'launch' })) as { id: string };
    await call('browser_act', { operation: 'open', sessionId: browser.id, url });
    const before = (await call('browser_read', {
      operation: 'snapshot',
      sessionId: browser.id,
    })) as { accessibility: string };
    expect(before.accessibility).toContain('BROKEN');

    const page = (await call('fs_read', { operation: 'read', path: pageFile })) as {
      sha256: string;
    };
    await call('fs_write', {
      operation: 'patch',
      path: pageFile,
      expectedSha256: page.sha256,
      unifiedDiff: '@@ -1 +1 @@\n-BROKEN\n+FIXED\n',
    });
    const testSource = (await call('fs_read', { operation: 'read', path: testFile })) as {
      sha256: string;
      content: string;
    };
    await call('fs_write', {
      operation: 'patch',
      path: testFile,
      expectedSha256: testSource.sha256,
      unifiedDiff:
        "@@ -1,3 +1,3 @@\n import assert from 'node:assert/strict'; import fs from 'node:fs'; import test from 'node:test';\n-const expected = 'BROKEN\\n';\n+const expected = 'FIXED\\n';\n test('page',()=>assert.equal(fs.readFileSync('page.txt','utf8'),expected));\n",
    });
    const secondTest = (await call('terminal', {
      operation: 'run',
      command: 'node --test page.test.mjs',
      workingDirectory: root,
    })) as { exitCode: number };
    expect(secondTest.exitCode).toBe(0);

    await call('browser_act', { operation: 'open', sessionId: browser.id, url });
    const after = (await call('browser_read', {
      operation: 'snapshot',
      sessionId: browser.id,
    })) as { accessibility: string };
    expect(after.accessibility).toContain('FIXED');

    const status = (await call('git_read', { operation: 'status', repository: root })) as {
      stdout: string;
    };
    expect(status.stdout).toContain('page.txt');
    const diff = (await call('git_read', { operation: 'diff', repository: root })) as {
      stdout: string;
    };
    expect(diff.stdout).toContain('+FIXED');
    await callApproved('git_write', {
      operation: 'add',
      repository: root,
      paths: ['README.md', 'page.txt', 'page.test.mjs'],
    });
    const preflight = (await call('git_read', {
      operation: 'preflight',
      repository: root,
    })) as { findings: unknown[]; stagedDiff: string };
    expect(preflight.findings).toEqual([]);
    expect(preflight.stagedDiff).toContain('+FIXED');
    await callApproved('git_write', {
      operation: 'commit',
      repository: root,
      message: 'fix fixture page',
    });
    const log = (await call('git_read', { operation: 'log', repository: root, limit: 1 })) as {
      stdout: string;
    };
    expect(log.stdout).toContain('fix fixture page');

    await call('jobs', { operation: 'cancel', jobId: job.id });
    await call('browser_act', { operation: 'close', sessionId: browser.id });
    const audit = (await call('audit_read', { afterSequence: 0, limit: 500 })) as {
      entries: { result: string; tool: string }[];
    };
    expect(audit.entries.some((entry) => entry.result === 'approval_required')).toBe(true);
    expect(audit.entries.some((entry) => entry.tool === 'browser_read')).toBe(true);
    expect(
      audit.entries.some((entry) => entry.tool === 'git_write' && entry.result === 'succeeded'),
    ).toBe(true);

    await client.close();
    client = undefined;
    await http.close();
    http = undefined;
  }, 45_000);
});
