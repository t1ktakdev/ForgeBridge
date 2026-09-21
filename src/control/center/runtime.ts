/** Browser-side runtime. Kept separate; assembled under the per-response CSP nonce. */
export const runtimeSource = String.raw`
const storage = {
  get(area, key, fallback) {
    try {
      return window[area].getItem(key) || fallback;
    } catch {
      return fallback;
    }
  },
  set(area, key, value) {
    try {
      window[area].setItem(key, value);
    } catch {}
  },
  remove(area, key) {
    try {
      window[area].removeItem(key);
    } catch {}
  },
};
const languagePreference = storage.get('localStorage', 'forgebridge-language', '');
const themePreference = storage.get('localStorage', 'forgebridge-theme', 'dark');
const state = {
  language: ['en', 'ru'].includes(languagePreference)
    ? languagePreference
    : navigator.language.toLowerCase().startsWith('ru')
      ? 'ru'
      : 'en',
  theme: ['dark', 'light', 'system'].includes(themePreference) ? themePreference : 'dark',
  authValue: storage.get('sessionStorage', 'forgebridge-token', ''),
  status: null,
  audit: [],
  auditCursor: 0,
  connected: false,
  lastUpdated: null,
  page: 'overview',
  settingsSection: 'general',
  sessionTab: 'browser',
  approvalTab: 'requests',
  query: '',
  filter: 'all',
  search: '',
  popover: null,
  dialog: null,
  dirty: false,
  actionPending: false,
  refreshPromise: null,
};
const systemTheme = window.matchMedia('(prefers-color-scheme: light)');
function effectiveTheme() {
  return state.theme === 'system' ? (systemTheme.matches ? 'light' : 'dark') : state.theme;
}
function applyTheme() {
  document.documentElement.dataset.theme = effectiveTheme();
  document.querySelector('meta[name="color-scheme"]').content = effectiveTheme();
}
function setTheme(theme) {
  state.theme = theme;
  storage.set('localStorage', 'forgebridge-theme', theme);
  applyTheme();
  renderShell();
  if (state.page === 'settings' && state.settingsSection === 'appearance') renderPage(false);
}
function setLanguage(language) {
  if (!['ru', 'en'].includes(language)) return;
  state.language = language;
  storage.set('localStorage', 'forgebridge-language', language);
  closePopover();
  renderPage(true);
  if (document.getElementById('connect-overlay').classList.contains('open')) openConnect();
}
function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const next = navigation.includes(parts[0]) ? parts[0] : 'overview';
  if (state.page !== next) {
    state.query = '';
    state.filter = 'all';
    state.dirty = false;
  }
  state.page = next;
  if (next === 'settings' && settingsSections.includes(parts[1])) state.settingsSection = parts[1];
  closePopover();
  if (state.dialog) closeDialog();
  document.getElementById('sidebar').classList.remove('mobile-open');
  renderPage(true);
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function navigate(page) {
  if (location.hash === '#/' + page) route();
  else location.hash = '/' + page;
}
async function request(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        Authorization: 'Bearer ' + state.authValue,
        'Content-Type': 'application/json',
        'X-ForgeBridge-CSRF': csrfToken,
        ...options?.headers,
      },
    });
    let body;
    try {
      body = await response.json();
    } catch {
      body = {};
    }
    if (!response.ok || body.ok === false) {
      const error = new Error(
        response.status === 401 || response.status === 403
          ? t('authFailed')
          : body.error?.message || t('requestFailed'),
      );
      error.status = response.status;
      throw error;
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}
function mergeAudit(payload) {
  const entries = Array.isArray(payload?.audit?.entries) ? payload.audit.entries : [];
  const map = new Map(state.audit.map((a) => [a.sequence, a]));
  for (const entry of entries) {
    map.set(entry.sequence, redact(entry));
    state.auditCursor = Math.max(state.auditCursor, Number(entry.sequence) || 0);
  }
  state.audit = [...map.values()]
    .sort((a, b) => (Number(b.sequence) || 0) - (Number(a.sequence) || 0))
    .slice(0, 500);
}
async function refresh(force) {
  if (state.refreshPromise) return state.refreshPromise;
  if (!state.authValue) return false;
  state.refreshPromise = (async () => {
    try {
      const results = await Promise.allSettled([
        request('/control/status'),
        request('/control/audit?limit=100&after=' + state.auditCursor),
      ]);
      if (results[0].status === 'rejected') throw results[0].reason;
      if (!results[0].value.status) throw new Error(t('requestFailed'));
      state.status = redact(results[0].value.status);
      state.connected = true;
      state.lastUpdated = Date.now();
      if (results[1].status === 'fulfilled') mergeAudit(results[1].value);
      else if (force) toast(t('audit') + ': ' + results[1].reason.message, 'error');
      const editing =
        state.dirty || document.activeElement?.matches('#page input,#page select,#page textarea');
      if (force || (!editing && !state.dialog)) renderPage(false);
      else renderShell();
      if (document.getElementById('connect-overlay').classList.contains('open')) closeConnect();
      updatePendingDialog();
      return true;
    } catch (error) {
      state.connected = false;
      renderShell();
      if (error.status === 401 || error.status === 403) {
        state.authValue = '';
        storage.remove('sessionStorage', 'forgebridge-token');
        openConnect();
        const node = document.getElementById('connect-error');
        if (node) node.textContent = t('authFailed');
      } else if (!state.status) {
        if (!document.getElementById('connect-overlay').classList.contains('open')) openConnect();
        const node = document.getElementById('connect-error');
        if (node) node.textContent = t('reconnecting');
      } else if (!state.dirty && !state.dialog) renderPage(false);
      if (force && state.status)
        toast(
          error.name === 'AbortError' ? t('reconnecting') : String(redact(error.message)),
          'error',
        );
      return false;
    } finally {
      state.refreshPromise = null;
    }
  })();
  return state.refreshPromise;
}
function updatePendingDialog() {
  if (!state.dialog) return;
  if (state.dialog.type === 'approval') {
    const a = state.status.pendingApprovals?.find((x) => x.id === state.dialog.id);
    const expired = !a || (a.expiresAt && Date.parse(a.expiresAt) <= Date.now());
    document.querySelectorAll('[data-action="approval-respond"]').forEach((b) => {
      b.disabled = !!expired;
      b.title = expired ? t('requestExpired') : '';
    });
  }
  if (state.dialog.type === 'job') {
    const job = state.status.jobs?.find((x) => x.id === state.dialog.id);
    if (job && job.status !== state.dialog.status) {
      openJob(job.id);
      return;
    }
    document
      .querySelectorAll('[data-action="job-cancel"]')
      .forEach((b) => (b.disabled = job?.status !== 'running'));
  }
}
async function action(name, payload, source) {
  if (state.actionPending) return false;
  if (!state.connected) {
    toast(t('reconnecting'), 'error');
    return false;
  }
  state.actionPending = true;
  if (source) {
    source.disabled = true;
    source.classList.add('busy');
  }
  try {
    if (state.refreshPromise) await state.refreshPromise;
    const result = await request('/control/action', {
      method: 'POST',
      body: JSON.stringify({ action: name, ...payload }),
    });
    if (result.status) state.status = redact(result.status);
    state.dirty = false;
    if (name === 'revoke') {
      state.connected = false;
      state.authValue = '';
      storage.remove('sessionStorage', 'forgebridge-token');
      state.status = null;
      state.audit = [];
      state.auditCursor = 0;
      if (state.dialog) closeDialog();
      renderPage(false);
      openConnect();
    } else await refresh(true);
    toast(t('actionDone'));
    return true;
  } catch (error) {
    toast(String(redact(error.message || t('requestFailed'))), 'error');
    return false;
  } finally {
    state.actionPending = false;
    if (source) {
      source.disabled = false;
      source.classList.remove('busy');
    }
  }
}
function toast(message, kind) {
  const node = document.createElement('div');
  node.className = 'toast ' + (kind || '');
  node.innerHTML =
    icon(kind === 'error' ? 'info' : 'checkCircle') + '<span>' + h(message) + '</span>';
  document.getElementById('toast-stack').append(node);
  setTimeout(() => {
    node.classList.add('leaving');
    setTimeout(() => node.remove(), 200);
  }, 3800);
}
function closePopover() {
  document.getElementById('popover-host').replaceChildren();
  state.popover = null;
  document
    .querySelectorAll('[aria-expanded="true"]')
    .forEach((n) => n.setAttribute('aria-expanded', 'false'));
}
function togglePopover(kind) {
  if (state.popover === kind) return closePopover();
  closePopover();
  state.popover = kind;
  let html = '';
  if (kind === 'profile')
    html =
      '<div class="popover profile-menu" role="menu"><div class="popover-head truncate">' +
      h(state.status?.device?.name || 'ForgeBridge') +
      '</div>' +
      [
        ['device-details', 'devices', 'deviceDetails'],
        ['settings-general', 'settings', 'settings'],
        ['connect-open', 'key', 'changeToken'],
      ]
        .map(
          ([action, ic, label]) =>
            '<button class="menu-item" role="menuitem" data-action="' +
            action +
            '">' +
            icon(ic) +
            h(t(label)) +
            '</button>',
        )
        .join('') +
      '</div>';
  else {
    const approvals = state.status?.pendingApprovals || [];
    const foreground = state.status?.execution?.foregroundActions || [];
    html =
      '<div class="popover"><div class="popover-head">' +
      h(t('notifications')) +
      '</div>' +
      (approvals.length
        ? approvals
            .slice(0, 5)
            .map(
              (a) =>
                '<button class="search-result" data-action="approval-review" data-id="' +
                h(a.id) +
                '">' +
                iconBox('shield', 'gold', true) +
                '<span class="grow">' +
                rowTitle(a.operation || a.capability, t('reviewRequired')) +
                '</span>' +
                icon('chevron') +
                '</button>',
            )
            .join('')
        : '') +
      (foreground.length
        ? '<button class="menu-item" data-action="settings-execution">' +
          icon('devices') +
          h(t('foregroundActions')) +
          ' Р’В· ' +
          foreground.length +
          '</button>'
        : '') +
      (!approvals.length && !foreground.length
        ? empty('checkCircle', 'noNotifications', 'noNotificationsHint', true)
        : '') +
      '</div>';
  }
  document.getElementById('popover-host').innerHTML = html;
  document
    .getElementById(kind === 'profile' ? 'profile-button' : 'notification-button')
    .setAttribute('aria-expanded', 'true');
}
function globalSearch() {
  const q = state.search.trim().toLocaleLowerCase(locale());
  if (!q) return closePopover();
  state.popover = 'search';
  let results = [];
  const s = state.status || {};
  const add = (group, label, sub, action, id, ic, kind) => {
    if ([label, sub, t(group)].join(' ').toLocaleLowerCase(locale()).includes(q))
      results.push({ group, label, sub, action, id, ic, kind });
  };
  navigation.forEach((k) => add('overview', t(k), '', 'navigate', k, k));
  projectRecords(s).forEach((p) =>
    add('projects', basename(p.root), p.root, 'project-details', p.root, 'projects'),
  );
  deviceRecords(s).forEach((d) =>
    add('devices', d.name, d.hostname, 'device-details', d.id, 'devices'),
  );
  (s.jobs || []).forEach((j) =>
    add('jobs', jobTitle(j), j.workingDirectory, 'job-details', j.id, 'gear'),
  );
  (s.pendingApprovals || []).forEach((a) =>
    add('approvals', a.operation || a.capability, a.capability, 'approval-review', a.id, 'shield'),
  );
  (s.browserSessions || []).forEach((x) =>
    add(
      'sessions',
      browserTitle(x),
      x.pages?.[0]?.url,
      'session-details',
      x.id,
      'browser',
      'browser',
    ),
  );
  (s.terminalSessions || []).forEach((x) =>
    add(
      'sessions',
      x.shell || t('terminal'),
      x.command,
      'session-details',
      x.id,
      'terminal',
      'terminal',
    ),
  );
  state.audit.forEach((a) =>
    add('audit', a.operation || a.tool, a.actorId, 'audit-details', a.sequence, 'audit'),
  );
  results = results.slice(0, 18);
  let last = '';
  document.getElementById('popover-host').innerHTML =
    '<div class="popover search-popover" aria-label="' +
    h(t('searchResults')) +
    '">' +
    (results.length
      ? results
          .map((r) => {
            let group =
              r.group === last ? '' : '<div class="search-group">' + h(t(r.group)) + '</div>';
            last = r.group;
            return (
              group +
              '<button class="search-result" data-action="' +
              r.action +
              '" data-id="' +
              h(r.id) +
              '"' +
              (r.kind ? ' data-kind="' + r.kind + '"' : '') +
              '>' +
              iconBox(r.ic, '', true) +
              '<span class="grow"><strong class="truncate">' +
              h(r.label) +
              '</strong><small class="truncate">' +
              h(r.sub || t(r.group)) +
              '</small></span>' +
              icon('chevron') +
              '</button>'
            );
          })
          .join('')
      : empty('search', 'noResults', 'noResultsHint', true)) +
    '</div>';
}
function formError(form, message) {
  const el = form.querySelector('.form-error');
  if (el) el.textContent = message;
  else toast(message, 'error');
}
async function submitForm(form, source) {
  const kind = form.dataset.form;
  if (!form.reportValidity()) return;
  const values = new FormData(form);
  let ok = false;
  if (kind === 'connect') {
    const value = String(values.get('token') || '').trim();
    if (!value) return formError(form, t('enterToken'));
    state.authValue = value;
    if (source) {
      source.disabled = true;
      source.classList.add('busy');
    }
    try {
      const csrf = await request('/control/csrf');
      if (csrf.csrfToken) csrfToken = csrf.csrfToken;
      const ok = await refresh(true);
      if (ok) storage.set('sessionStorage', 'forgebridge-token', value);
    } catch (error) {
      formError(form, error.message);
    } finally {
      if (source) {
        source.disabled = false;
        source.classList.remove('busy');
      }
    }
    return;
  }
  if (kind === 'rename') {
    const name = String(values.get('name') || '').trim();
    if (!name || name.length > 128) return formError(form, t('invalidName'));
    ok = await action('rename_device', { name }, source);
  } else if (kind === 'project') {
    const root = String(values.get('root') || '').trim();
    if (!root) return formError(form, t('invalidRoot'));
    ok = await action(
      'set_project_policy',
      { root, mode: values.get('mode'), autonomy: values.get('autonomy') },
      source,
    );
  } else if (kind === 'mode') ok = await action('set_mode', { mode: values.get('mode') }, source);
  else if (kind === 'execution') {
    const profile = values.get('profile');
    if (profile === state.status.execution?.profile) return toast(t('updated'));
    return confirmAction('apply', 'executionHelp', 'set_execution_profile', { profile }, false);
  }
  if (ok && state.dialog) closeDialog();
}
async function handleAction(node) {
  const key = node.dataset.action,
    id = node.dataset.id;
  if (node.disabled) return;
  if (!['profile-toggle', 'notifications-toggle'].includes(key)) closePopover();
  switch (key) {
    case 'navigate':
      return navigate(id);
    case 'mobile-menu':
      document.getElementById('sidebar').classList.toggle('mobile-open');
      return;
    case 'theme-toggle':
      return setTheme(effectiveTheme() === 'dark' ? 'light' : 'dark');
    case 'language':
      return setLanguage(id);
    case 'profile-toggle':
      return togglePopover('profile');
    case 'notifications-toggle':
      return togglePopover('notifications');
    case 'settings-general':
      return navigate('settings/general');
    case 'settings-execution':
      return navigate('settings/execution');
    case 'settings-section':
      state.settingsSection = id;
      state.dirty = false;
      return navigate('settings/' + id);
    case 'refresh': {
      node.disabled = true;
      node.classList.add('busy');
      try {
        if (await refresh(true)) toast(t('updated'));
      } finally {
        node.disabled = false;
        node.classList.remove('busy');
      }
      return;
    }
    case 'clear-filters':
      state.query = '';
      state.filter = 'all';
      return renderPage(false);
    case 'session-tab':
      state.sessionTab = id;
      state.query = '';
      return renderPage(false);
    case 'approval-tab':
      state.approvalTab = id;
      state.query = '';
      state.filter = 'all';
      return renderPage(false);
    case 'grants-page':
      state.approvalTab = 'grants';
      if (state.dialog) closeDialog();
      return navigate('approvals');
    case 'dialog-close':
      return closeDialog();
    case 'connect-open':
      return openConnect();
    case 'connect-close':
      return closeConnect();
    case 'project-details':
      return openProjectDetails(id);
    case 'project-edit':
      return openProjectEdit(id);
    case 'project-global':
      return confirmAction(
        'useGlobal',
        'globalHelp',
        'remove_project_profile',
        { root: id },
        false,
      );
    case 'device-details':
      return state.status && openDeviceDetails();
    case 'device-rename':
      return openRename();
    case 'agent-pause':
      return confirmAction('pause', 'pauseHelp', 'pause', {}, false);
    case 'agent-resume':
      return action('resume', {}, node).then((ok) => {
        if (ok && state.dialog) closeDialog();
      });
    case 'agent-revoke':
      return confirmAction('revoke', 'revokeHelp', 'revoke', {}, true);
    case 'job-details':
      return openJob(id);
    case 'job-cancel':
      return confirmAction('cancelJob', 'cancelJobHelp', 'cancel_job', { jobId: id }, true);
    case 'session-details':
      return openSession(id, node.dataset.kind);
    case 'session-close':
      return confirmAction(
        node.dataset.kind === 'browser' ? 'closeBrowser' : 'killTerminal',
        'closeSessionHelp',
        node.dataset.kind === 'browser' ? 'close_browser_session' : 'kill_terminal',
        { sessionId: id },
        true,
      );
    case 'approval-review':
      return openApproval(id);
    case 'approval-respond': {
      const a = state.status.pendingApprovals?.find((x) => x.id === id);
      const response = node.dataset.response;
      if (!a || !(a.allowedResponses || ['deny', 'once']).includes(response))
        return toast(t('requestExpired'), 'error');
      const payload = { approvalId: id, response };
      if (response === 'temporary') {
        payload.durationMs = 900000;
        payload.maxUses = 1000;
      }
      if (response === 'session') payload.maxUses = 1000;
      if (await action('approval', payload, node)) closeDialog();
      return;
    }
    case 'grant-revoke':
      return confirmAction('revokeGrant', 'revokeGrantHelp', 'revoke_grant', { grantId: id }, true);
    case 'audit-details':
      return openAudit(id);
    case 'foreground':
      return confirmAction(
        node.dataset.response,
        'foregroundActions',
        'foreground_action',
        { foregroundActionId: id, response: node.dataset.response },
        false,
      );
    case 'confirm-action': {
      const d = state.dialog;
      if (d?.action && (await action(d.action, d.payload, node))) {
        if (state.dialog) closeDialog();
      }
      return;
    }
    case 'submit-project':
    case 'submit-rename':
    case 'submit-mode':
    case 'submit-execution':
      return submitForm(node.closest('form'), node);
  }
}
function setupEvents() {
  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (target) {
      void handleAction(target);
      return;
    }
    if (event.target === document.getElementById('dialog-overlay')) closeDialog();
    if (event.target.closest('.sidebar-scrim'))
      document.getElementById('sidebar').classList.remove('mobile-open');
    if (!event.target.closest('.popover') && !event.target.closest('.global-search'))
      closePopover();
  });
  document.addEventListener('submit', (event) => {
    const form = event.target.closest('[data-form]');
    if (form) {
      event.preventDefault();
      void submitForm(form, form.querySelector('button.primary'));
    }
  });
  document.addEventListener('input', (event) => {
    const input = event.target;
    if (input.id === 'global-search') {
      state.search = input.value;
      globalSearch();
    }
    if (input.dataset.field === 'query') {
      state.query = input.value;
      filteredContent();
    }
    if (input.closest('form') && input.closest('#page')) state.dirty = true;
  });
  document.addEventListener('change', (event) => {
    const input = event.target;
    if (input.dataset.field === 'filter') {
      state.filter = input.value;
      filteredContent();
    }
    if (input.dataset.field === 'theme') setTheme(input.value);
    if (input.dataset.field === 'language') setLanguage(input.value);
    if (input.dataset.field === 'background') {
      const enabled = input.checked;
      input.checked = !!state.status.execution?.backgroundMode;
      confirmAction('apply', 'backgroundHelp', 'set_background_mode', { enabled }, false);
    }
    if (input.closest('form') && input.closest('#page')) state.dirty = true;
  });
  document.addEventListener('keydown', (event) => {
    trapFocus(event);
    if (event.defaultPrevented) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (!state.dialog && !document.getElementById('connect-overlay').classList.contains('open')) {
        const input = document.getElementById('global-search');
        input.focus();
        input.select();
      }
    }
    if (event.key === 'Escape') {
      closePopover();
      document.getElementById('sidebar').classList.remove('mobile-open');
    }
    if (state.popover === 'search' && event.key === 'ArrowDown') {
      event.preventDefault();
      const items = [...document.querySelectorAll('.search-result')];
      const i = items.indexOf(document.activeElement);
      items[(i + 1) % items.length]?.focus();
    }
    if (state.popover === 'search' && event.key === 'ArrowUp') {
      event.preventDefault();
      const items = [...document.querySelectorAll('.search-result')];
      const i = items.indexOf(document.activeElement);
      items[(i - 1 + items.length) % items.length]?.focus();
    }
  });
  window.addEventListener('hashchange', route);
  systemTheme.addEventListener('change', () => {
    if (state.theme === 'system') {
      applyTheme();
      renderShell();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.authValue && !state.actionPending) void refresh(false);
  });
}
function start() {
  applyTheme();
  setupEvents();
  route();
  if (state.authValue) void refresh(true);
  else openConnect();
  setInterval(() => {
    if (!document.hidden && state.authValue && !state.actionPending) void refresh(false);
  }, 5000);
}
`;
