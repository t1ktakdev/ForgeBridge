import { FORGEBRIDGE_VERSION } from '../version.js';

export const STATUS_UI_URI = 'ui://forgebridge/status-v1.html';

export function renderAppsStatusUi(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    :root { color-scheme: light dark; font: 14px/1.4 system-ui, sans-serif; }
    body { margin: 0; padding: 12px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(140px,1fr)); gap: 8px; }
    .card { border: 1px solid color-mix(in srgb,currentColor 20%,transparent); border-radius: 10px; padding: 10px; }
    .label { opacity: .65; font-size: 12px; }
    .value { font-weight: 650; overflow-wrap: anywhere; }
    .detail { margin-top: 8px; border-left: 3px solid #d38b28; padding: 8px 10px; background: color-mix(in srgb,currentColor 6%,transparent); }
    .detail code { overflow-wrap: anywhere; }
    .actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 9px; }
    button { border: 1px solid color-mix(in srgb,currentColor 28%,transparent); border-radius: 7px; padding: 6px 9px; background: color-mix(in srgb,currentColor 8%,transparent); color: inherit; cursor: pointer; }
    button:hover:not(:disabled) { background: color-mix(in srgb,currentColor 14%,transparent); }
    button:disabled { cursor: default; opacity: .45; }
    button[data-response="deny"] { border-color: color-mix(in srgb,#d45b5b 60%,transparent); }
    .event { margin-top: 6px; font: 12px/1.35 ui-monospace, monospace; overflow-wrap: anywhere; }
    h2 { margin: 16px 0 6px; font-size: 14px; }
    #notice { margin-top: 10px; opacity: .75; }
  </style>
</head>
<body>
  <div class="grid" id="status"><div class="card">Waiting for ForgeBridge status…</div></div>
  <section><h2>Pending approvals</h2><div id="approvals">Waiting…</div></section>
  <section><h2>Recent audit activity</h2><div id="audit">Waiting…</div></section>
  <div id="notice">Approval buttons become active after the MCP App handshake completes.</div>
  <script>
    (() => {
      const target = document.querySelector('#status');
      const approvals = document.querySelector('#approvals');
      const audit = document.querySelector('#audit');
      const notice = document.querySelector('#notice');
      const pending = new Map();
      let nextId = 1;
      let initialized = false;
      let lastPayload;
      let appToken;

      function request(method, params) {
        const id = nextId++;
        window.parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
        return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      }

      function captureAppMeta(result) {
        const candidate = result?._meta?.['io.github.t1ktakdev/forgebridge']?.approvalToken;
        if (typeof candidate === 'string' && candidate.length >= 32) appToken = candidate;
      }

      async function callServerTool(name, args) {
        const result = await request('tools/call', { name, arguments: args });
        captureAppMeta(result);
        const structured = result?.structuredContent;
        if (result?.isError || structured?.ok === false) {
          throw new Error(structured?.error?.message || 'ForgeBridge tool call failed');
        }
        return result;
      }

      async function refresh() {
        const result = await callServerTool('render_status', {});
        render(result.structuredContent);
      }

      function card(label, value) {
        const node = document.createElement('div'); node.className = 'card';
        const key = document.createElement('div'); key.className = 'label'; key.textContent = label;
        const content = document.createElement('div'); content.className = 'value'; content.textContent = String(value ?? '—');
        node.append(key, content); return node;
      }

      function responseLabel(response) {
        if (response === 'once') return 'Allow once';
        if (response === 'temporary') return 'Allow 15 min';
        if (response === 'session') return 'Allow session';
        return 'Deny';
      }

      function approvalNode(item) {
        const node = document.createElement('div'); node.className = 'detail';
        const title = document.createElement('div'); title.className = 'value';
        title.textContent = item.capability + ' · ' + item.operation;
        const risk = document.createElement('div'); risk.textContent = item.risk;
        const scope = document.createElement('code'); scope.textContent = item.scope?.value ?? '—';
        const actions = document.createElement('div'); actions.className = 'actions';
        for (const response of item.allowedResponses ?? []) {
          const button = document.createElement('button');
          button.dataset.response = response;
          button.textContent = responseLabel(response);
          button.disabled = !initialized || typeof appToken !== 'string' || typeof item.id !== 'string';
          button.addEventListener('click', async () => {
            button.disabled = true;
            notice.textContent = 'Applying ' + responseLabel(response).toLowerCase() + '…';
            try {
              const args = { approvalId: item.id, response, appToken };
              if (response === 'temporary') {
                args.durationMs = 15 * 60 * 1000;
                args.maxUses = 1000;
              } else if (response === 'session') {
                args.maxUses = 1000;
              }
              await callServerTool('approval_respond', args);
              await refresh();
              notice.textContent = 'Approval updated. Retry the original action with its approval ID.';
            } catch (error) {
              notice.textContent = error instanceof Error ? error.message : String(error);
              if (lastPayload) render(lastPayload);
            }
          });
          actions.append(button);
        }
        node.append(title, risk, scope);
        if (actions.childElementCount > 0) node.append(actions);
        return node;
      }

      function render(payload) {
        lastPayload = payload;
        const value = payload?.data ?? payload ?? {};
        const device = value.device ?? {};
        const execution = value.execution ?? {};
        target.replaceChildren(
          card('Device', device.name), card('OS', value.platform?.os), card('Mode', String(value.mode ?? '').toUpperCase()),
          card('Execution', String(execution.profile ?? '').toUpperCase()), card('Browser', execution.forceHeadlessBrowser ? 'Headless' : 'Configured'),
          card('State', value.paused ? 'Paused' : 'Active'), card('Jobs', value.jobs?.length ?? 0),
          card('Approvals', value.pendingApprovals?.length ?? 0), card('Foreground pending', execution.foregroundActions?.length ?? 0)
        );
        const approvalItems = (value.pendingApprovals ?? []).map(approvalNode);
        approvals.replaceChildren(...approvalItems);
        if (!approvalItems.length) approvals.textContent = 'No pending approvals.';
        const auditItems = (value.recentAudit ?? []).slice(-12).reverse().map((item) => {
          const node = document.createElement('div'); node.className = 'event';
          node.textContent = item.timestamp + ' · ' + item.tool + '/' + item.operation + ' · ' + item.result;
          return node;
        });
        audit.replaceChildren(...auditItems);
        if (!auditItems.length) audit.textContent = 'No recent activity.';
      }

      window.addEventListener('message', (event) => {
        if (event.source !== window.parent) return;
        const message = event.data;
        if (!message || message.jsonrpc !== '2.0') return;
        if (message.id !== undefined && pending.has(message.id)) {
          const callback = pending.get(message.id); pending.delete(message.id);
          if (message.error) callback.reject(message.error); else callback.resolve(message.result);
          return;
        }
        if (message.method === 'ui/notifications/tool-result') {
          captureAppMeta(message.params);
          render(message.params?.structuredContent);
        }
        if (message.method === 'ui/notifications/tool-cancelled') {
          target.textContent = message.params?.reason || 'Status request cancelled.';
        }
      }, { passive: true });

      request('ui/initialize', { protocolVersion: '2026-01-26', appInfo: { name: 'ForgeBridge status', version: ${JSON.stringify(FORGEBRIDGE_VERSION)} }, appCapabilities: {} })
        .then(() => {
          initialized = true;
          window.parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} }, '*');
          notice.textContent = 'Approvals remain digest-, scope-, capability-, actor-, and session-bound in the local ForgeBridge permission engine.';
          if (lastPayload) render(lastPayload);
        })
        .catch(() => {
          notice.textContent = 'This host did not complete the MCP App handshake; use the local ForgeBridge Control page for approvals.';
        });
      const initialToolResult = window.openai?.toolResponseMetadata?.mcp_tool_result ?? window.openai?.toolResponseMetadata?.call_tool_result;
      if (initialToolResult) captureAppMeta(initialToolResult);
      if (window.openai?.toolOutput) render(window.openai.toolOutput);

    })();
  </script>
</body>
</html>`;
}
