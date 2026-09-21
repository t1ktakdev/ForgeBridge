import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import { afterEach, describe, expect, it } from 'vitest';
import { renderAppsStatusUi } from '../../src/control/apps-ui.js';

const APP_TOKEN = 'test-forgebridge-app-token-0123456789abcdef';

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
                    id: '11111111-1111-4111-8111-111111111111',
                    capability: 'git.push',
                    operation: 'push',
                    risk: 'Pushes commits',
                    scope: { value: 'D:\\Project' },
                    allowedResponses: ['deny', 'once', 'temporary'],
                  },
                ],
                recentAudit: [
                  {
                    timestamp: '2026-09-14T00:00:00.000Z',
                    tool: 'git_write',
                    operation: 'push',
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
    expect(await page.locator('#approvals').innerText()).toContain('git.push · push');
    expect(await page.locator('#approvals').innerText()).toContain('Allow once');
    expect(await page.locator('#approvals').innerText()).toContain('Allow 15 min');
    expect(await page.locator('#audit').innerText()).toContain(
      'git_write/push · approval_required',
    );
    expect(errors).toEqual([]);
  });

  it('responds to an approval through the MCP Apps tools/call bridge and refreshes status', async () => {
    browser = await launchBrowser();
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent('<iframe id="app"></iframe>');

    await page.evaluate(
      ({ html, appToken }) => {
        const frame = document.querySelector<HTMLIFrameElement>('#app');
        if (!frame) throw new Error('Missing app frame');
        (
          window as unknown as {
            forgebridgeCalls: { method?: string; params?: Record<string, unknown> }[];
          }
        ).forgebridgeCalls = [];
        window.addEventListener('message', (event) => {
          if (event.source !== frame.contentWindow) return;
          const message = event.data as {
            jsonrpc?: string;
            id?: number;
            method?: string;
            params?: {
              name?: string;
              arguments?: Record<string, unknown>;
            };
          };
          (
            window as unknown as {
              forgebridgeCalls: { method?: string; params?: Record<string, unknown> }[];
            }
          ).forgebridgeCalls.push({
            method: message.method,
            params: message.params,
          });
          if (message.id === undefined) return;
          if (message.method === 'ui/initialize') {
            frame.contentWindow?.postMessage({ jsonrpc: '2.0', id: message.id, result: {} }, '*');
            return;
          }
          if (message.method === 'tools/call' && message.params?.name === 'approval_respond') {
            frame.contentWindow?.postMessage(
              {
                jsonrpc: '2.0',
                id: message.id,
                result: {
                  structuredContent: {
                    ok: true,
                    data: {
                      approvalId: message.params.arguments?.['approvalId'],
                      status: 'approved',
                      response: 'once',
                    },
                  },
                },
              },
              '*',
            );
            return;
          }
          if (message.method === 'tools/call' && message.params?.name === 'render_status') {
            frame.contentWindow?.postMessage(
              {
                jsonrpc: '2.0',
                id: message.id,
                result: {
                  _meta: { 'io.github.t1ktakdev/forgebridge': { approvalToken: appToken } },
                  structuredContent: {
                    ok: true,
                    data: {
                      device: { name: 'Workstation' },
                      platform: { os: 'win32' },
                      mode: 'balanced',
                      paused: false,
                      jobs: [],
                      pendingApprovals: [],
                      recentAudit: [],
                    },
                  },
                },
              },
              '*',
            );
          }
        });
        frame.srcdoc = html;
      },
      { html: renderAppsStatusUi(), appToken: APP_TOKEN },
    );

    const app = page.frameLocator('#app');
    await expect.poll(async () => app.locator('#notice').innerText()).toContain('digest-');

    await page.evaluate((appToken) => {
      const frame = document.querySelector<HTMLIFrameElement>('#app');
      frame?.contentWindow?.postMessage(
        {
          jsonrpc: '2.0',
          method: 'ui/notifications/tool-result',
          params: {
            _meta: { 'io.github.t1ktakdev/forgebridge': { approvalToken: appToken } },
            structuredContent: {
              ok: true,
              data: {
                device: { name: 'Workstation' },
                platform: { os: 'win32' },
                mode: 'balanced',
                paused: false,
                jobs: [],
                pendingApprovals: [
                  {
                    id: '22222222-2222-4222-8222-222222222222',
                    capability: 'git.push',
                    operation: 'push',
                    risk: 'Pushes commits',
                    scope: { value: 'D:\\Project' },
                    allowedResponses: ['deny', 'once', 'temporary'],
                  },
                ],
                recentAudit: [],
              },
            },
          },
        },
        '*',
      );
    }, APP_TOKEN);

    await app.getByRole('button', { name: 'Allow once' }).click();
    await expect
      .poll(async () => app.locator('#approvals').innerText())
      .toContain('No pending approvals.');

    const approvalCall = await page.evaluate(() => {
      const calls = (
        window as unknown as {
          forgebridgeCalls: {
            method?: string;
            params?: { name?: string; arguments?: Record<string, unknown> };
          }[];
        }
      ).forgebridgeCalls;
      return calls.find(
        (call) => call.method === 'tools/call' && call.params?.name === 'approval_respond',
      );
    });
    expect(approvalCall?.params?.arguments).toMatchObject({
      approvalId: '22222222-2222-4222-8222-222222222222',
      response: 'once',
      appToken: APP_TOKEN,
    });
    expect(errors).toEqual([]);
  });
});
