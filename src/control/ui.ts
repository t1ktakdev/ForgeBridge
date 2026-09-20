export function renderControlUi(nonce: string, csrfToken: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>ForgeBridge Control</title>
  <style nonce="${nonce}">
    :root { color-scheme: dark; font: 15px/1.45 system-ui, sans-serif; background: #111318; color: #eef1f6; }
    body { margin: 0; padding: 24px; }
    main { max-width: 980px; margin: auto; }
    h1 { margin: 0 0 8px; font-size: 24px; }
    h2 { margin-top: 26px; font-size: 17px; }
    .muted { color: #9ca8b8; }
    .row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    input, button, select { border: 1px solid #394252; border-radius: 7px; background: #1b2029; color: inherit; padding: 8px 10px; }
    input { flex: 1; min-width: 280px; }
    button { cursor: pointer; }
    button.danger { border-color: #a84747; }
    .card { margin-top: 14px; border: 1px solid #2c3441; border-radius: 10px; background: #171b22; padding: 14px; }
    pre { overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 360px; }
    .approval { border-left: 3px solid #d99a42; margin: 10px 0; padding: 10px 12px; background: #1e1b16; }
    .ok { color: #7ddc9a; } .bad { color: #ff8a8a; }
  </style>
</head>
<body>
<main>
  <h1>ForgeBridge Control</h1>
  <p class="muted">The control token stays in this tab's session storage and is sent only to this loopback origin.</p>
  <div class="row">
    <input id="token" type="password" autocomplete="off" placeholder="Paste the local control token">
    <button id="connect">Connect</button>
    <button id="refresh">Refresh</button>
  </div>
  <p id="message" class="muted">Not connected.</p>
  <div class="row">
    <select id="mode" aria-label="Permission mode"><option value="ask">ASK</option><option value="balanced">BALANCED</option><option value="full">FULL</option></select>
    <button id="set-mode">Change Permission Mode</button>
    <button data-action="pause">Pause Agent</button>
    <button data-action="resume">Resume Agent</button>
    <button class="danger" data-action="revoke">Revoke Access</button>
  </div>
  <div class="row">
    <select id="execution-profile" aria-label="Execution profile"><option value="normal">NORMAL</option><option value="background">BACKGROUND</option><option value="gaming">GAMING</option></select>
    <button id="set-execution-profile">Change Execution Profile</button>
    <span class="muted">BACKGROUND is the default. NORMAL permits explicitly approved foreground actions.</span>
  </div>
  <div class="row">
    <input id="project-root" autocomplete="off" placeholder="Canonical project root">
    <select id="project-mode" aria-label="Project permission mode"><option value="ask">ASK</option><option value="balanced">BALANCED</option><option value="full">FULL</option></select>
    <select id="project-autonomy" aria-label="Project autonomy"><option value="standard">STANDARD APPROVALS</option><option value="trusted-local">TRUSTED LOCAL DEV</option></select>
    <button id="set-project-policy">Set Project Policy</button>
    <button id="remove-project-mode">Use Global Mode</button>
  </div>
  <p class="muted">Trusted local dev removes repeat approval for reviewed repository-code inside that project. Push, destructive shell commands, elevation, persistence, secrets, and out-of-scope access remain gated or denied.</p>
  <section class="card"><h2>Status</h2><pre id="status">—</pre></section>
  <section class="card"><h2>Active grants</h2><div id="grants">—</div></section>
  <section class="card"><h2>Pending approvals</h2><div id="approvals">—</div></section>
  <section class="card"><h2>Deferred foreground actions</h2><div id="foreground-actions">—</div></section>
  <section class="card"><h2>Recent actions</h2><pre id="audit">—</pre></section>
</main>
<script nonce="${nonce}">
(() => {
  const controlTokenInput = document.querySelector('#token');
  const message = document.querySelector('#message');
  const status = document.querySelector('#status');
  const approvals = document.querySelector('#approvals');
  const audit = document.querySelector('#audit');
  const grants = document.querySelector('#grants');
  const foregroundActions = document.querySelector('#foreground-actions');
  const csrfToken = ${JSON.stringify(csrfToken)};
  controlTokenInput.value = sessionStorage.getItem('forgebridge-token') || '';
  const headers = () => ({ Authorization: 'Bearer ' + controlTokenInput.value, 'Content-Type': 'application/json', 'X-ForgeBridge-CSRF': csrfToken });
  async function request(url, options = {}) {
    const response = await fetch(url, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || 'Request failed: ' + response.status);
    return body;
  }
  function approvalNode(item) {
    const node = document.createElement('div');
    node.className = 'approval';
    const details = document.createElement('pre');
    details.textContent = JSON.stringify(item, null, 2);
    node.append(details);
    for (const response of item.allowedResponses) {
      const button = document.createElement('button');
      button.textContent = response === 'temporary' ? 'Allow 15 min' : response;
      button.addEventListener('click', async () => {
        await request('/control/action', { method: 'POST', body: JSON.stringify({ action: 'approval', approvalId: item.id, response, durationMs: 900000, maxUses: 1000 }) });
        await refresh();
      });
      node.append(button);
    }
    return node;
  }
  function grantNode(item) {
    const node = document.createElement('div');
    node.className = 'approval';
    const details = document.createElement('pre');
    details.textContent = JSON.stringify(item, null, 2);
    const button = document.createElement('button');
    button.textContent = 'Revoke grant';
    button.addEventListener('click', async () => {
      await request('/control/action', { method: 'POST', body: JSON.stringify({ action: 'revoke_grant', grantId: item.id }) });
      await refresh();
    });
    node.append(details, button);
    return node;
  }
  function foregroundNode(item) {
    const node = document.createElement('div');
    node.className = 'approval';
    const details = document.createElement('pre');
    details.textContent = JSON.stringify(item, null, 2);
    node.append(details);
    for (const response of ['approve', 'defer', 'cancel']) {
      const button = document.createElement('button');
      button.textContent = response;
      button.addEventListener('click', async () => {
        await request('/control/action', { method: 'POST', body: JSON.stringify({ action: 'foreground_action', foregroundActionId: item.id, response }) });
        await refresh();
      });
      node.append(button);
    }
    return node;
  }
  async function refresh() {
    sessionStorage.setItem('forgebridge-token', controlTokenInput.value);
    try {
      const [state, events] = await Promise.all([request('/control/status'), request('/control/audit?limit=50')]);
      status.textContent = JSON.stringify(state.status, null, 2);
      document.querySelector('#mode').value = state.status.mode;
      document.querySelector('#execution-profile').value = state.status.execution.profile;
      approvals.replaceChildren(...state.status.pendingApprovals.map(approvalNode));
      if (!state.status.pendingApprovals.length) approvals.textContent = 'No pending approvals.';
      grants.replaceChildren(...state.status.activeGrants.map(grantNode));
      if (!state.status.activeGrants.length) grants.textContent = 'No active grants.';
      foregroundActions.replaceChildren(...state.status.execution.foregroundActions.map(foregroundNode));
      if (!state.status.execution.foregroundActions.length) foregroundActions.textContent = 'No foreground actions are pending.';
      audit.textContent = JSON.stringify(events.audit.entries, null, 2);
      message.textContent = state.status.paused ? 'Connected — agent paused.' : 'Connected — agent active.';
      message.className = state.status.paused ? 'bad' : 'ok';
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : String(error);
      message.className = 'bad';
    }
  }
  document.querySelector('#connect').addEventListener('click', refresh);
  document.querySelector('#refresh').addEventListener('click', refresh);
  document.querySelector('#set-mode').addEventListener('click', async () => {
    await request('/control/action', { method: 'POST', body: JSON.stringify({ action: 'set_mode', mode: document.querySelector('#mode').value }) });
    await refresh();
  });
  document.querySelector('#set-execution-profile').addEventListener('click', async () => {
    await request('/control/action', { method: 'POST', body: JSON.stringify({ action: 'set_execution_profile', profile: document.querySelector('#execution-profile').value }) });
    await refresh();
  });
  document.querySelector('#set-project-policy').addEventListener('click', async () => {
    await request('/control/action', { method: 'POST', body: JSON.stringify({ action: 'set_project_policy', root: document.querySelector('#project-root').value, mode: document.querySelector('#project-mode').value, autonomy: document.querySelector('#project-autonomy').value }) });
    await refresh();
  });
  document.querySelector('#remove-project-mode').addEventListener('click', async () => {
    await request('/control/action', { method: 'POST', body: JSON.stringify({ action: 'remove_project_profile', root: document.querySelector('#project-root').value }) });
    await refresh();
  });
  document.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', async () => {
    const action = button.dataset.action;
    if (action === 'revoke' && !confirm('Revoke all sessions, grants, approvals, and rotate the local token?')) return;
    await request('/control/action', { method: 'POST', body: JSON.stringify({ action }) });
    if (action === 'revoke') { controlTokenInput.value = ''; sessionStorage.removeItem('forgebridge-token'); }
    else await refresh();
  }));
})();
</script>
</body>
</html>`;
}
