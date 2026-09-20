import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import { afterEach, describe, expect, it } from 'vitest';
import { renderAppsStatusUi } from '../../src/control/apps-ui.js';

async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    const candidates = [
      path.join(
        process.env['ProgramFiles'] ?? 'C:\\Program Files',
        'Google',
        'Chrome',
        'Application',
        'chrome.exe',
      ),
      path.join(
        process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
        'Microsoft',
        'Edge',
        'Application',
        'msedge.exe',
      ),
    ];
    const executablePath = candidates.find((candidate) => existsSync(candidate));
    if (!executablePath) throw error;
    return chromium.launch({ headless: true, executablePath });
  }
}

describe('MCP Apps status UI', () => {
  let browser: Browser | undefined;

  afterEach(async () => browser?.close());

  it('renders status, pending approvals, and audit events from a standard tool-result notification', async () => {
    browser = await launchBrowser();
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent(renderAppsStatusUi());
    await page.evaluate(() => {
      window.postMessage(
        {
          jsonrpc: '2.0',
          method: 'ui/notifications/tool-result',
          params: {
            structuredContent: {
              ok: true,
              data: {
                device: { name: 'Workstation' },
                platform: { os: 'win32' },
                mode: 'balanced',
                paused: false,
                jobs: [{ id: 'job-1' }],
                pendingApprovals: [
                  {
                    capability: 'git.commit',
                    operation: 'commit',
                    risk: 'Creates a commit',
                    scope: { value: 'D:\\Project' },
                  },
                ],
                recentAudit: [
                  {
                    timestamp: '2026-09-14T00:00:00.000Z',
                    tool: 'git_write',
                    operation: 'commit',
                    result: 'approval_required',
                  },
                ],
              },
            },
          },
        },
        '*',
      );
    });

    await expect.poll(async () => page.locator('#status').innerText()).toContain('Workstation');
    expect(await page.locator('#approvals').innerText()).toContain('git.commit · commit');
    expect(await page.locator('#audit').innerText()).toContain(
      'git_write/commit · approval_required',
    );
    expect(errors).toEqual([]);
  });
});
