/** Browser-side dialogs. Kept separate; assembled under the per-response CSP nonce. */
export const dialogsSource = String.raw`
let returnFocus = null;
let dialogTimer = null;
function openDialog(title, subtitle, body, options) {
  const overlay = document.getElementById('dialog-overlay');
  clearTimeout(dialogTimer);
  if (!overlay.classList.contains('open')) returnFocus = document.activeElement;
  state.dialog = options || {};
  overlay.className = 'overlay' + (options?.drawer ? ' drawer-overlay' : '');
  overlay.innerHTML =
    '<section class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" tabindex="-1"><header class="dialog-head"><div class="grow"><h2 id="dialog-title">' +
    h(title) +
    '</h2>' +
    (subtitle ? '<p>' + h(subtitle) + '</p>' : '') +
    '</div><button class="icon-button" data-action="dialog-close" aria-label="' +
    h(t('close')) +
    '">' +
    icon('close') +
    '</button></header><div class="dialog-body">' +
    body +
    '</div></section>';
  overlay.removeAttribute('inert');
  document.getElementById('app').inert = true;
  document.body.classList.add('dialog-open');
  requestAnimationFrame(() => {
    overlay.classList.add('open');
    const input = overlay.querySelector('input:not([type=radio]),select');
    (input || overlay.querySelector('.dialog')).focus();
  });
}
function closeDialog() {
  const overlay = document.getElementById('dialog-overlay');
  overlay.classList.remove('open');
  overlay.setAttribute('inert', '');
  document.getElementById('app').inert = false;
  document.body.classList.remove('dialog-open');
  state.dialog = null;
  if (returnFocus?.isConnected) returnFocus.focus();
  else document.querySelector('.nav-link.active')?.focus();
  dialogTimer = setTimeout(() => {
    overlay.replaceChildren();
  }, 230);
}
function confirmAction(title, copy, action, payload, danger) {
  openDialog(
    t(title),
    t(copy),
    '<div class="notice">' +
      icon(danger ? 'shield' : 'info') +
      '<span>' +
      h(t('reviewChanges')) +
      '</span></div><div class="form-actions">' +
      button('cancel', 'dialog-close', null, 'subtle') +
      button(title, 'confirm-action', null, danger ? 'danger' : 'primary') +
      '</div>',
    { action, payload },
  );
}
function openProjectDetails(root) {
  const p = projectRecords(state.status).find((x) => x.root === root);
  if (!p) return;
  const a = projectActivity(p.root);
  openDialog(
    basename(p.root),
    t('projectDetails'),
    '<div class="drawer-identity">' +
      iconBox('projects', 'gold') +
      '<div class="grow"><h3>' +
      h(basename(p.root)) +
      '</h3><p class="subtitle">' +
      h(t(p.profile ? 'policyProfiles' : 'globalPolicy')) +
      '</p></div>' +
      badge(p.mode) +
      '</div>' +
      detailGrid([
        ['projectRoot', p.root, 'mono'],
        ['branch', p.branch || t('noData')],
        ['permissionMode', t(p.mode)],
        ['autonomy', t(p.autonomy || 'standard')],
        ['device', state.status.device?.name],
        ['activity', a ? date(a.timestamp) : t('noActivity')],
      ]) +
      note('branchUnavailable') +
      '<div class="form-actions">' +
      button('editPolicy', 'project-edit', p.root, 'primary') +
      (p.profile ? button('useGlobal', 'project-global', p.root, 'subtle') : '') +
      '</div>',
    { drawer: true, type: 'project', id: root },
  );
}
function openProjectEdit(root) {
  const p = projectRecords(state.status).find((x) => x.root === root);
  const select = (name, values, value) =>
    '<select class="field" name="' +
    name +
    '" aria-label="' +
    h(t(name === 'mode' ? 'permissionMode' : 'autonomy')) +
    '">' +
    values
      .map(
        (v) =>
          '<option value="' +
          v +
          '"' +
          (v === value ? ' selected' : '') +
          '>' +
          h(t(v)) +
          '</option>',
      )
      .join('') +
    '</select>';
  const body =
    '<form data-form="project"><div class="form-stack"><label class="field-label">' +
    h(t('projectRoot')) +
    '<input class="field mono" name="root" placeholder="D:\\Projects\\Example" value="' +
    h(p?.root || '') +
    '"' +
    (p ? ' readonly' : '') +
    ' required autocomplete="off"></label><label class="field-label">' +
    h(t('permissionMode')) +
    select('mode', ['ask', 'balanced', 'full'], p?.mode || state.status.mode) +
    '</label><label class="field-label">' +
    h(t('autonomy')) +
    select('autonomy', ['standard', 'trusted-local'], p?.autonomy || 'standard') +
    '</label><div class="form-error" id="form-error" role="alert"></div></div><div class="form-actions">' +
    button('cancel', 'dialog-close', null, 'subtle') +
    button('savePolicy', 'submit-project', null, 'primary') +
    '</div></form>';
  openDialog(t(p ? 'editPolicy' : 'addPolicy'), t('policyHelp'), body, {
    type: 'project-edit',
    id: root,
  });
}
function openDeviceDetails() {
  const s = state.status;
  const d = s.device || {};
  openDialog(
    d.name || t('device'),
    t('deviceDetails'),
    '<div class="drawer-identity">' +
      iconBox('devices') +
      '<div class="grow"><h3>' +
      h(d.hostname) +
      '</h3><p class="subtitle">' +
      h(t('localDevice')) +
      '</p></div>' +
      badge(state.connected ? (s.paused ? 'paused' : 'online') : 'offline') +
      '</div>' +
      detailGrid([
        ['name', d.name],
        ['hostname', d.hostname],
        [
          'platform',
          [s.platform?.os, s.platform?.release, s.platform?.architecture]
            .filter(Boolean)
            .join(' · '),
        ],
        ['version', d.forgeBridgeVersion],
        ['lastSeen', date(d.lastSeen)],
        ['activeProject', d.activeProject, 'mono'],
        ['executionProfile', t(d.executionProfile || s.execution?.profile || 'unknown')],
        ['permissionMode', t(s.mode)],
        ['id', d.id, 'mono'],
      ]) +
      '<div class="form-actions">' +
      button('rename', 'device-rename', d.id, 'primary') +
      button(
        s.paused ? 'resume' : 'pause',
        s.paused ? 'agent-resume' : 'agent-pause',
        null,
        'subtle',
      ) +
      '</div><div class="divider"></div>' +
      button('revoke', 'agent-revoke', null, 'danger', 'lock'),
    { drawer: true, type: 'device' },
  );
}
function openRename() {
  openDialog(
    t('rename'),
    t('renameHelp'),
    '<form data-form="rename"><label class="field-label">' +
      h(t('deviceName')) +
      '<input name="name" class="field" maxlength="128" required value="' +
      h(state.status.device?.name) +
      '" autocomplete="off"></label><div class="form-error" id="form-error" role="alert"></div><div class="form-actions">' +
      button('cancel', 'dialog-close', null, 'subtle') +
      button('save', 'submit-rename', null, 'primary') +
      '</div></form>',
    { type: 'rename' },
  );
}
function openApproval(id) {
  const a = (state.status.pendingApprovals || []).find((x) => x.id === id);
  if (!a) return toast(t('requestExpired'), 'error');
  const allowed = (a.allowedResponses || ['deny', 'once']).filter((x) =>
    ['deny', 'once', 'temporary', 'session'].includes(x),
  );
  const expiry = Date.parse(a.expiresAt);
  const body =
    '<div class="drawer-identity">' +
    iconBox('shield', 'gold') +
    '<div class="grow"><h3>' +
    h(a.operation || a.capability) +
    '</h3><p class="subtitle">' +
    h(t('approvalDetail')) +
    '</p></div>' +
    badge(risk(a)) +
    '</div>' +
    detailGrid([
      ['capability', a.capability, 'mono'],
      ['operation', a.operation],
      ['reason', a.reason || a.risk],
      ['scope', (a.scope?.kind || '') + ': ' + (a.scope?.value || '—'), 'mono'],
      ['project', approvalProject(a) || t('localDevice')],
      ['requestedBy', a.actorId || a.requestedBy],
      ['created', date(a.createdAt)],
      ['expires', date(a.expiresAt)],
      ['id', a.id, 'mono'],
    ]) +
    (a.redactedArguments
      ? '<details><summary>' +
        h(t('redactedDetails')) +
        '</summary><pre class="raw">' +
        h(JSON.stringify(redact(a.redactedArguments), null, 2)) +
        '</pre></details>'
      : '') +
    notice('approvalHelp') +
    '<div class="form-actions">' +
    allowed
      .sort(
        (a, b) =>
          ['deny', 'once', 'temporary', 'session'].indexOf(a) -
          ['deny', 'once', 'temporary', 'session'].indexOf(b),
      )
      .map(
        (response) =>
          '<button class="button ' +
          (response === 'deny' ? 'danger' : response === 'once' ? 'primary' : '') +
          '" data-action="approval-respond" data-id="' +
          h(id) +
          '" data-response="' +
          response +
          '"' +
          (Number.isFinite(expiry) && expiry <= Date.now() ? ' disabled' : '') +
          '>' +
          h(t(response)) +
          '</button>',
      )
      .join('') +
    '</div>';
  openDialog(t('review'), t('approvalsDescription'), body, { drawer: true, type: 'approval', id });
}
function openJob(id) {
  const j = (state.status.jobs || []).find((x) => x.id === id);
  if (!j) return;
  openDialog(
    t('backgroundJob'),
    jobTitle(j),
    '<div class="drawer-identity">' +
      iconBox('gear') +
      '<div class="grow">' +
      badge(j.status) +
      '</div>' +
      (j.status === 'running'
        ? '<div class="progress-track indeterminate" aria-label="' +
          h(t('progressUnknown')) +
          '"></div>'
        : '') +
      '</div>' +
      detailGrid([
        ['command', j.command, 'mono'],
        ['cwd', j.workingDirectory, 'mono'],
        ['status', t(j.status)],
        ['elapsed', elapsed(j)],
        ['created', date(j.createdAt)],
        ['started', date(j.startedAt)],
        ['finished', date(j.finishedAt)],
        ['exitCode', j.exitCode],
        ['id', j.id, 'mono'],
      ]) +
      (j.status === 'running'
        ? '<div class="form-actions">' +
          button('cancelJob', 'job-cancel', j.id, 'danger') +
          '</div>'
        : ''),
    { drawer: true, type: 'job', id, status: j.status },
  );
}
function openSession(id, kind) {
  kind = kind || state.sessionTab;
  const browser = kind === 'browser';
  const x = (
    browser ? state.status.browserSessions || [] : state.status.terminalSessions || []
  ).find((x) => x.id === id);
  if (!x) return;
  const rows = browser
    ? [
        ['url', x.pages?.[0]?.url, 'mono'],
        ['pages', (x.pages || []).length],
        ['status', t(x.headless ? 'headless' : 'foreground')],
      ]
    : [
        ['shell', x.shell],
        ['command', x.command, 'mono'],
        ['cwd', x.workingDirectory, 'mono'],
        ['status', t(x.status || 'unknown')],
      ];
  const body =
    detailGrid([...rows, ['created', date(x.createdAt || x.startedAt)], ['id', x.id, 'mono']]) +
    (browser && x.pages?.length
      ? '<div class="divider"></div><h3>' +
        h(t('pages')) +
        '</h3>' +
        x.pages
          .map(
            (p) =>
              '<div class="list-row">' +
              iconBox('browser', '', true) +
              '<div class="row-main">' +
              rowTitle(p.title || p.url, p.url) +
              '</div></div>',
          )
          .join('')
      : '') +
    (browser || x.status === 'running'
      ? '<div class="form-actions"><button class="button danger" data-action="session-close" data-kind="' +
        kind +
        '" data-id="' +
        h(id) +
        '">' +
        h(t(browser ? 'closeBrowser' : 'killTerminal')) +
        '</button></div>'
      : notice('sessionStopped'));
  openDialog(browser ? browserTitle(x) : t('terminalSessions'), t('detailsReadOnly'), body, {
    drawer: true,
    type: 'session',
    id,
    kind,
  });
}
function openAudit(id) {
  const a = state.audit.find((x) => String(x.sequence) === String(id));
  if (!a) return;
  openDialog(
    t('auditDetails'),
    a.operation || a.tool,
    detailGrid([
      ['operation', a.operation],
      ['tool', a.tool],
      ['actor', a.actorId],
      ['timestamp', date(a.timestamp)],
      ['result', t(a.result)],
      ['capability', a.capability],
      ['scope', a.scope?.value, 'mono'],
      ['duration', a.durationMs == null ? '—' : a.durationMs + ' ms'],
      ['sequence', a.sequence],
      ['id', a.correlationId, 'mono'],
    ]) +
      '<details><summary>' +
      h(t('redactedDetails')) +
      '</summary><pre class="raw">' +
      h(JSON.stringify(redact(a), null, 2)) +
      '</pre></details>',
    { drawer: true, type: 'audit', id },
  );
}
function openConnect() {
  const overlay = document.getElementById('connect-overlay');
  if (state.dialog) closeDialog();
  closePopover();
  overlay.innerHTML =
    '<section class="dialog connect-card" role="dialog" aria-modal="true" aria-labelledby="connect-title"><div class="brand">' +
    logo() +
    '<div><div class="brand-title">ForgeBridge</div><div class="brand-subtitle">' +
    h(t('controlCenter')) +
    '</div></div></div><h2 id="connect-title">' +
    h(t('connectTitle')) +
    '</h2><p>' +
    h(t('connectHelp')) +
    '</p><form data-form="connect"><label class="field-label">' +
    h(t('tokenLabel')) +
    '<input class="field" name="token" type="password" autocomplete="off" spellcheck="false" required></label><div id="connect-error" class="form-error" role="alert"></div><button type="submit" class="button primary">' +
    h(t('connect')) +
    '</button></form><p class="token-note">' +
    h(t('tokenStorage')) +
    '</p>' +
    (state.connected ? button('cancel', 'connect-close', null, 'subtle') : '') +
    '</section>';
  overlay.removeAttribute('inert');
  overlay.classList.add('open');
  document.getElementById('app').inert = true;
  setTimeout(() => overlay.querySelector('input')?.focus(), 50);
}
function closeConnect() {
  const o = document.getElementById('connect-overlay');
  o.classList.remove('open');
  o.setAttribute('inert', '');
  document.getElementById('app').inert = false;
  setTimeout(() => o.replaceChildren(), 230);
}
function trapFocus(event) {
  const overlay =
    document.querySelector('.connect-overlay.open') ||
    document.querySelector('#dialog-overlay.open');
  if (!overlay) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    if (overlay.id === 'connect-overlay') {
      if (state.connected) closeConnect();
    } else closeDialog();
    return;
  }
  if (event.key !== 'Tab') return;
  const all = [
    ...overlay.querySelectorAll(
      'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary,[tabindex="0"]',
    ),
  ].filter((x) => x.offsetParent !== null);
  const first = all[0],
    last = all[all.length - 1];
  if (!first) return event.preventDefault();
  if (
    event.shiftKey &&
    (document.activeElement === first || !all.includes(document.activeElement))
  ) {
    event.preventDefault();
    last.focus();
  } else if (
    !event.shiftKey &&
    (document.activeElement === last || !all.includes(document.activeElement))
  ) {
    event.preventDefault();
    first.focus();
  }
}
`;
