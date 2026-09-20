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
    .event { margin-top: 6px; font: 12px/1.35 ui-monospace, monospace; overflow-wrap: anywhere; }
    h2 { margin: 16px 0 6px; font-size: 14px; }
    #notice { margin-top: 10px; opacity: .7; }
  </style>
</head>
<body>
  <div class="grid" id="status"><div class="card">Waiting for ForgeBridge status…</div></div>
  <section><h2>Pending approvals</h2><div id="approvals">Waiting…</div></section>
  <section><h2>Recent audit activity</h2><div id="audit">Waiting…</div></section>
  <div id="notice">Approvals and access changes must be completed in the local ForgeBridge Control page.</div>
  <script>
    (() => {
      const target = document.querySelector('#status');
      const approvals = document.querySelector('#approvals');
      const audit = document.querySelector('#audit');
      const pending = new Map();
      let nextId = 1;
      function request(method, params) {
        const id = nextId++;
        window.parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
        return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      }
      function card(label, value) {
        const node = document.createElement('div'); node.className = 'card';
        const key = document.createElement('div'); key.className = 'label'; key.textContent = label;
        const content = document.createElement('div'); content.className = 'value'; content.textContent = String(value ?? '—');
        node.append(key, content); return node;
      }
      function render(payload) {
        const value = payload?.data ?? payload ?? {};
        const device = value.device ?? {};
        const execution = value.execution ?? {};
        target.replaceChildren(
          card('Device', device.name), card('OS', value.platform?.os), card('Mode', String(value.mode ?? '').toUpperCase()),
          card('Execution', String(execution.profile ?? '').toUpperCase()), card('Browser', execution.forceHeadlessBrowser ? 'Headless' : 'Configured'),
          card('State', value.paused ? 'Paused' : 'Active'), card('Jobs', value.jobs?.length ?? 0),
          card('Approvals', value.pendingApprovals?.length ?? 0), card('Foreground pending', execution.foregroundActions?.length ?? 0)
        );
        const approvalItems = (value.pendingApprovals ?? []).map((item) => {
          const node = document.createElement('div'); node.className = 'detail';
          const title = document.createElement('div'); title.className = 'value';
          title.textContent = item.capability + ' · ' + item.operation;
          const risk = document.createElement('div'); risk.textContent = item.risk;
          const scope = document.createElement('code'); scope.textContent = item.scope?.value ?? '—';
          node.append(title, risk, scope); return node;
        });
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
        if (message.method === 'ui/notifications/tool-result') render(message.params?.structuredContent);
        if (message.method === 'ui/notifications/tool-cancelled') {
          target.textContent = message.params?.reason || 'Status request cancelled.';
        }
      }, { passive: true });
      request('ui/initialize', { protocolVersion: '2026-01-26', appInfo: { name: 'ForgeBridge status', version: ${JSON.stringify(FORGEBRIDGE_VERSION)} }, appCapabilities: {} })
        .then(() => window.parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} }, '*'))
        .catch(() => {});
      if (window.openai?.toolOutput) render(window.openai.toolOutput);
    })();
  </script>
</body>
</html>`;
}
