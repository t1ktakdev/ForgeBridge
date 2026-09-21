/** Browser-side views. Kept separate; assembled under the per-response CSP nonce. */
export const viewsSource = String.raw`
const navigation = [
  'overview',
  'projects',
  'devices',
  'jobs',
  'sessions',
  'approvals',
  'audit',
  'settings',
];
const settingsSections = [
  'general',
  'device',
  'permissions',
  'execution',
  'projects',
  'roots',
  'security',
  'appearance',
  'language',
  'advanced',
];
const settingsIcons = {
  general: 'sliders',
  device: 'devices',
  permissions: 'shield',
  execution: 'jobs',
  projects: 'projects',
  roots: 'projects',
  security: 'lock',
  appearance: 'sun',
  language: 'language',
  advanced: 'terminal',
};
function renderShell() {
  document.getElementById('navigation').setAttribute('aria-label', t('controlCenter'));
  document.documentElement.lang = state.language;
  document.title = t(state.page) + ' · ForgeBridge';
  document.getElementById('brand-subtitle').textContent = t('controlCenter');
  document.getElementById('navigation').innerHTML = navigation
    .map(
      (k) =>
        '<a class="nav-link ' +
        (state.page === k ? 'active' : '') +
        '" href="#/' +
        k +
        '"' +
        (state.page === k ? ' aria-current="page"' : '') +
        ' aria-label="' +
        h(t(k)) +
        '" title="' +
        h(t(k)) +
        '">' +
        icon(k) +
        '<span class="nav-label">' +
        h(t(k)) +
        '</span>' +
        (k === 'approvals' && state.status?.pendingApprovals?.length
          ? '<span class="nav-badge">' + state.status.pendingApprovals.length + '</span>'
          : '') +
        '</a>',
    )
    .join('');
  const search = document.getElementById('global-search');
  search.placeholder = t('search');
  search.setAttribute('aria-label', t('search'));
  document.getElementById('mobile-menu').setAttribute('aria-label', t('openMenu'));
  document.getElementById('theme-toggle').innerHTML = icon(
    effectiveTheme() === 'dark' ? 'sun' : 'moon',
  );
  document.getElementById('theme-toggle').setAttribute('aria-label', t('theme'));
  document.getElementById('notification-button').setAttribute('aria-label', t('notifications'));
  document.getElementById('notification-button').innerHTML =
    icon('bell') +
    (state.status?.pendingApprovals?.length || state.status?.execution?.foregroundActions?.length
      ? '<span class="notification-dot"></span>'
      : '');
  document.getElementById('language-switch').innerHTML = ['en', 'ru']
    .map(
      (k) =>
        '<button type="button" data-action="language" data-id="' +
        k +
        '" class="' +
        (state.language === k ? 'active' : '') +
        '" aria-pressed="' +
        (state.language === k) +
        '">' +
        k.toUpperCase() +
        '</button>',
    )
    .join('');
  const name = state.status?.device?.name || 'ForgeBridge';
  document.getElementById('profile-button').innerHTML =
    '<span class="avatar">' +
    h(name.slice(0, 1).toUpperCase()) +
    '</span><span class="profile-name truncate">' +
    h(name) +
    '</span>' +
    icon('down');
  document.getElementById('profile-button').setAttribute('aria-label', t('deviceMenu'));
  document.getElementById('connection-button').innerHTML =
    '<span class="dot ' +
    (state.connected ? (state.status?.paused ? 'gold' : 'green') : '') +
    '"></span><span class="status-text grow">' +
    h(t(state.connected ? 'connected' : 'disconnected')) +
    '</span>' +
    icon('chevron');
  document.getElementById('connection-version').textContent = state.status?.device
    ?.forgeBridgeVersion
    ? 'v' + state.status.device.forgeBridgeVersion
    : 'ForgeBridge';
  document.getElementById('connection-button').setAttribute('aria-label', t('connection'));
}
function metrics(s) {
  const running = (s.jobs || []).filter((x) => x.status === 'running');
  const completed = (s.jobs || []).filter((x) => ['succeeded', 'completed'].includes(x.status));
  const defs = [
    ['projects', 'cube', projectRecords(s).length, t('policyProfiles'), 'gold'],
    [
      'devices',
      'devices',
      deviceRecords(s).length,
      t(state.connected && !s.paused ? 'localOnline' : 'needsAttention'),
      '',
    ],
    ['jobs', 'gear', running.length, completed.length + ' ' + t('completedRecent'), ''],
    [
      'approvals',
      'shield',
      (s.pendingApprovals || []).length,
      t(s.pendingApprovals?.length ? 'reviewRequired' : 'nothingWaiting'),
      'gold',
    ],
    [
      'sessions',
      'activity',
      (s.browserSessions || []).length + activeTerminals(s).length,
      (s.browserSessions || []).length +
        ' ' +
        t('browser').toLowerCase() +
        ' · ' +
        activeTerminals(s).length +
        ' ' +
        t('terminal').toLowerCase(),
      'green',
    ],
  ];
  return (
    '<div class="metrics">' +
    defs
      .map(
        ([page, ic, count, meta, color], i) =>
          '<a href="#/' +
          page +
          '" class="metric">' +
          iconBox(ic, color) +
          '<span class="metric-copy"><span class="metric-label">' +
          h(t(['projects', 'devices', 'runningJobs', 'pendingApprovals', 'activeSessions'][i])) +
          '</span><span class="metric-value">' +
          count +
          '</span><span class="metric-meta" title="' +
          h(meta) +
          '">' +
          h(meta) +
          '</span></span><span class="metric-chevron">' +
          icon('chevron') +
          '</span></a>',
      )
      .join('') +
    '</div>'
  );
}
function projectTable(s, compact) {
  let records = projectRecords(s);
  if (!compact)
    records = records.filter(
      (p) => matches(p) && (state.filter === 'all' || p.mode === state.filter),
    );
  const rows = (compact ? records.slice(0, 4) : records).map((p) => {
    const activity = projectActivity(p.root);
    return (
      '<tr><td><div class="project-cell">' +
      iconBox('projects') +
      '<button class="project-link" data-action="project-details" data-id="' +
      h(p.root) +
      '">' +
      rowTitle(basename(p.root), p.root) +
      '</button></div></td><td>' +
      badge(p.mode) +
      '</td>' +
      (compact
        ? ''
        : '<td title="' +
          h(p.branch || t('branchUnavailable')) +
          '">' +
          h(p.branch || '—') +
          '</td><td class="nowrap">' +
          h(t(p.autonomy || 'standard')) +
          '</td><td>' +
          h(s.device?.name || '—') +
          '</td><td class="nowrap" title="' +
          h(activity ? date(activity.timestamp) : t('noActivity')) +
          '">' +
          h(activity ? relative(activity.timestamp) : '—') +
          '</td>') +
      '<td>' +
      more('project-details', p.root) +
      '</td></tr>'
    );
  });
  return table(
    compact
      ? ['project', 'policy', '']
      : ['project', 'permissionMode', 'branch', 'autonomy', 'device', 'activity', ''],
    rows,
    !compact && (state.query || state.filter !== 'all')
      ? noMatches()
      : empty(
          'projects',
          'noProjects',
          'noProjectsHint',
          compact,
          compact ? '' : button('addPolicy', 'project-edit', null, 'primary', 'plus'),
        ),
    compact ? 'compact-projects' : 'page-table',
  );
}
function approvalTable(s, compact) {
  const all = s.pendingApprovals || [];
  const items = compact
    ? all.slice(0, 3)
    : all.filter((a) => matches(a) && (state.filter === 'all' || risk(a) === state.filter));
  const rows = items.map(
    (a) =>
      '<tr><td>' +
      rowTitle(a.operation || a.capability, a.capability) +
      '</td><td title="' +
      h(approvalProject(a) || t('localDevice')) +
      '">' +
      h(approvalProject(a) ? basename(approvalProject(a)) : t('localDevice')) +
      '</td><td>' +
      h(a.actorId || a.requestedBy || '—') +
      '</td><td class="nowrap" title="' +
      h(date(a.createdAt)) +
      '">' +
      h(relative(a.createdAt)) +
      '</td><td>' +
      badge(risk(a)) +
      '</td><td>' +
      button('review', 'approval-review', a.id, 'primary compact') +
      '</td></tr>',
  );
  return table(
    ['request', 'project', 'requestedBy', 'time', 'risk', ''],
    rows,
    !compact && (state.query || state.filter !== 'all')
      ? noMatches()
      : empty('checkCircle', 'noApprovals', 'noApprovalsHint', compact),
    compact ? '' : 'page-table',
  );
}
function compactJobs(s) {
  const all = s.jobs || [];
  const running = all.filter((x) => x.status === 'running');
  const items = [...running, ...all.filter((x) => x.status !== 'running')].slice(0, 5);
  if (!items.length) return empty('jobs', 'noJobs', 'noJobsHint', true);
  return items
    .map(
      (j) =>
        '<div class="list-row">' +
        iconBox('gear', '', true) +
        '<button class="row-main project-link" data-action="job-details" data-id="' +
        h(j.id) +
        '">' +
        rowTitle(jobTitle(j), basename(j.workingDirectory)) +
        '</button>' +
        (j.status === 'running'
          ? '<div class="progress-track indeterminate" title="' +
            h(t('progressUnknown')) +
            '"></div>'
          : badge(j.status)) +
        '<span class="small muted nowrap">' +
        h(elapsed(j)) +
        '</span>' +
        more('job-details', j.id) +
        '</div>',
    )
    .join('');
}
function compactSessions(s) {
  const items = state.sessionTab === 'browser' ? s.browserSessions || [] : activeTerminals(s);
  let html = sessionTabs((s.browserSessions || []).length, activeTerminals(s).length);
  if (!items.length)
    return (
      html +
      empty(
        state.sessionTab,
        'no' + (state.sessionTab === 'browser' ? 'Browser' : 'Terminal'),
        'noSessionsHint',
        true,
      )
    );
  return (
    html +
    items
      .slice(0, 4)
      .map(
        (x) =>
          '<div class="list-row">' +
          iconBox(state.sessionTab, '', true) +
          '<button class="row-main project-link" data-action="session-details" data-kind="' +
          state.sessionTab +
          '" data-id="' +
          h(x.id) +
          '">' +
          rowTitle(
            state.sessionTab === 'browser' ? browserTitle(x) : x.shell || t('terminal'),
            state.sessionTab === 'browser' ? x.pages?.[0]?.url : x.command,
          ) +
          '</button><span class="small muted nowrap">' +
          h(relative(x.createdAt || x.startedAt)) +
          '</span>' +
          more('session-details', x.id) +
          '</div>',
      )
      .join('')
  );
}
function compactTimeline() {
  if (!state.audit.length) return empty('clock', 'noAudit', 'noAuditHint', true);
  return (
    '<div class="timeline">' +
    state.audit
      .slice(0, 5)
      .map(
        (a) =>
          '<div class="timeline-row"><span class="timeline-marker ' +
          tone(a.result) +
          '"></span>' +
          iconBox(
            a.tool?.includes('browser')
              ? 'browser'
              : a.operation?.includes('approval')
                ? 'shield'
                : 'sessions',
            '',
            true,
          ) +
          '<button class="row-main" data-action="audit-details" data-id="' +
          h(a.sequence) +
          '">' +
          rowTitle(
            a.operation || a.tool || t('activity'),
            [a.tool, a.actorId].filter(Boolean).join(' · '),
          ) +
          '</button><time title="' +
          h(date(a.timestamp)) +
          '">' +
          h(relative(a.timestamp)) +
          '</time></div>',
      )
      .join('') +
    '</div>'
  );
}
function overviewPage(s) {
  const hour = new Date().getHours();
  const greeting = t(hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening');
  const name = s.device?.name || t('workstation');
  return (
    '<section class="hero">' +
    mountains() +
    '<div class="hero-copy"><h1>' +
    h(greeting) +
    ', <span class="greeting-name" title="' +
    h(name) +
    '">' +
    h(name) +
    '</span></h1><p>' +
    h(t(!state.connected ? 'heroOffline' : s.paused ? 'heroPaused' : 'heroReady')) +
    '</p></div><div class="hero-tagline">' +
    h(t('buildSecurely')) +
    '<br>' +
    h(t('moveFaster')) +
    '</div></section>' +
    metrics(s) +
    '<div class="overview-top">' +
    panel(
      'projects',
      'projects',
      projectTable(s, true),
      'projects',
      '',
      button('addPolicy', 'project-edit', null, 'full compact', 'plus'),
    ) +
    panel(
      'approvalsGrants',
      'approvals',
      approvalTable(s, true),
      'approvals',
      s.pendingApprovals?.length
        ? '<span class="badge round gold">' +
            s.pendingApprovals.length +
            ' ' +
            h(t('pending').toLowerCase()) +
            '</span>'
        : '',
      '<span>' +
        icon('lock') +
        ' ' +
        h(t('securityNote')) +
        '</span><button class="link-button" data-action="grants-page">' +
        h(t('grants')) +
        ' (' +
        (s.activeGrants || []).length +
        ')</button>',
    ) +
    '</div><div class="overview-bottom">' +
    panel('runningJobs', 'jobs', compactJobs(s), 'jobs') +
    panel('activeSessions', 'people', compactSessions(s), 'sessions') +
    panel('recentActivity', 'clock', compactTimeline(), 'audit') +
    '</div><div class="footer-line"><span class="row"><span class="dot ' +
    (state.connected ? 'green' : '') +
    '"></span>' +
    h(t(state.connected ? 'updated' : 'stale')) +
    ' · ' +
    h(
      state.lastUpdated
        ? new Date(state.lastUpdated).toLocaleTimeString(locale(), {
            hour: '2-digit',
            minute: '2-digit',
          })
        : '—',
    ) +
    '</span><span>' +
    h(s.device?.hostname || '') +
    ' · ' +
    h(t('localControl')) +
    '</span></div>'
  );
}
function projectsPage(s) {
  return (
    pageHead(
      'projects',
      'projectsDescription',
      button('addPolicy', 'project-edit', null, 'primary', 'plus'),
    ) +
    '<section class="panel">' +
    searchToolbar(['all', 'ask', 'balanced', 'full']) +
    '<div id="filtered-content">' +
    projectTable(s, false) +
    '</div><footer class="panel-foot"><span>' +
    projectRecords(s).length +
    ' ' +
    h(t('projects').toLowerCase()) +
    '</span><span>' +
    h(t('projectBoundary')) +
    '</span></footer></section>'
  );
}
function deviceCard(d) {
  const health = state.connected ? (d.paused ? 'paused' : 'online') : 'offline';
  return (
    '<section class="panel device-card"><div class="device-top"><div class="device-visual">' +
    icon('devices') +
    '</div><div class="grow"><h2>' +
    h(d.name) +
    '</h2><div class="subtitle">' +
    h(d.hostname || '—') +
    ' · ' +
    h(d.platform?.os || '—') +
    '</div></div>' +
    badge(health) +
    '</div>' +
    detailGrid([
      ['activeProject', d.activeProject, 'mono'],
      [
        'platform',
        [d.platform?.os, d.platform?.release, d.platform?.architecture].filter(Boolean).join(' · '),
      ],
      ['version', d.forgeBridgeVersion],
      ['lastSeen', date(d.lastSeen)],
      ['executionProfile', t(d.executionProfile || d.execution?.profile || 'unknown')],
      ['permissionMode', t(d.mode || 'unknown')],
    ]) +
    '<div class="device-actions">' +
    button('details', 'device-details', d.id, '', 'devices') +
    button('rename', 'device-rename', d.id) +
    (d.paused
      ? button('resume', 'agent-resume', null, '', 'play')
      : button('pause', 'agent-pause', null, 'subtle', 'pause')) +
    '</div></section>'
  );
}
function devicesPage(s) {
  const records = deviceRecords(s).filter(matches);
  return (
    pageHead(
      'devices',
      'devicesDescription',
      button('refresh', 'refresh', null, 'subtle', 'refresh'),
    ) +
    '<section class="panel">' +
    searchToolbar(null) +
    '</section><div id="filtered-content" class="device-grid devices-body">' +
    (records.length ? records.map(deviceCard).join('') : noMatches()) +
    '<section class="panel info-panel"><div class="icon-box gold">' +
    icon('link') +
    '</div><h2>' +
    h(t('localControl')) +
    '</h2><p>' +
    h(t('localOnly')) +
    '</p><div class="divider"></div>' +
    detailGrid([
      ['transport', s.device?.transport],
      ['hostname', s.device?.hostname],
      ['created', date(s.device?.createdAt)],
    ]) +
    '</section></div>'
  );
}
function jobsTable(s) {
  const items = (s.jobs || []).filter(
    (j) =>
      matches(j) &&
      (state.filter === 'all' ||
        j.status === state.filter ||
        (state.filter === 'completed' && j.status === 'succeeded')),
  );
  return table(
    ['command', 'cwd', 'status', 'elapsed', 'started', ''],
    items.map(
      (j) =>
        '<tr><td><button class="project-link" data-action="job-details" data-id="' +
        h(j.id) +
        '">' +
        rowTitle(jobTitle(j), shortId(j.id)) +
        '</button></td><td><span class="mono truncate" title="' +
        h(j.workingDirectory) +
        '">' +
        h(j.workingDirectory || '—') +
        '</span></td><td><div class="row">' +
        badge(j.status) +
        (j.status === 'running'
          ? '<span class="progress-track indeterminate" aria-label="' +
            h(t('progressUnknown')) +
            '"></span>'
          : '') +
        '</div></td><td class="nowrap">' +
        h(elapsed(j)) +
        '</td><td class="nowrap">' +
        h(relative(j.startedAt || j.createdAt)) +
        '</td><td>' +
        more('job-details', j.id) +
        '</td></tr>',
    ),
    state.query || state.filter !== 'all' ? noMatches() : empty('jobs', 'noJobs', 'noJobsHint'),
    'page-table',
  );
}
function jobsPage(s) {
  return (
    pageHead('jobs', 'jobsDescription', button('refresh', 'refresh', null, 'subtle', 'refresh')) +
    '<section class="panel">' +
    searchToolbar(['all', 'running', 'queued', 'completed', 'failed', 'cancelled', 'interrupted']) +
    '<div id="filtered-content">' +
    jobsTable(s) +
    '</div><footer class="panel-foot"><span>' +
    h(t('jobHistory')) +
    '</span><span>' +
    h(t('jobLimit')) +
    '</span></footer></section>'
  );
}
function sessionsTable(s) {
  const browser = state.sessionTab === 'browser';
  const all = browser ? s.browserSessions || [] : s.terminalSessions || [];
  const items = all.filter(matches);
  return table(
    browser
      ? ['browser', 'pages', 'status', 'created', '']
      : ['shell', 'command', 'cwd', 'status', 'created', ''],
    items.map(
      (x) =>
        '<tr><td><div class="row">' +
        iconBox(browser ? 'browser' : 'terminal', '', true) +
        '<button class="project-link" data-action="session-details" data-kind="' +
        state.sessionTab +
        '" data-id="' +
        h(x.id) +
        '">' +
        rowTitle(
          browser ? browserTitle(x) : x.shell || t('terminal'),
          browser ? x.pages?.[0]?.url : shortId(x.id),
        ) +
        '</button></div></td>' +
        (browser
          ? '<td>' +
            (x.pages || []).length +
            '</td><td>' +
            badge(x.headless ? 'headless' : 'foreground') +
            '</td>'
          : '<td><span class="mono">' +
            h(x.command || '—') +
            '</span></td><td class="mono">' +
            h(x.workingDirectory || '—') +
            '</td><td>' +
            badge(x.status || 'unknown') +
            '</td>') +
        '<td class="nowrap">' +
        h(date(x.createdAt || x.startedAt)) +
        '</td><td>' +
        more('session-details', x.id) +
        '</td></tr>',
    ),
    state.query
      ? noMatches()
      : empty(state.sessionTab, browser ? 'noBrowser' : 'noTerminal', 'noSessionsHint'),
    'page-table',
  );
}
function sessionsPage(s) {
  return (
    pageHead('sessions', 'sessionsDescription') +
    sessionTabs((s.browserSessions || []).length, (s.terminalSessions || []).length) +
    '<section class="panel">' +
    searchToolbar(null) +
    '<div id="filtered-content">' +
    sessionsTable(s) +
    '</div></section>'
  );
}
function grantsTable(s) {
  const items = (s.activeGrants || []).filter(matches);
  return table(
    ['capability', 'scope', 'actor', 'expires', 'uses', ''],
    items.map(
      (g) =>
        '<tr><td>' +
        rowTitle(g.capability, shortId(g.id)) +
        '</td><td class="mono">' +
        h(g.scope?.value || '—') +
        '</td><td>' +
        h(g.actorId || '—') +
        '</td><td>' +
        h(g.expiresAt ? date(g.expiresAt) : t('session')) +
        '</td><td>' +
        h(g.uses ?? 0) +
        (g.maxUses ? ' / ' + g.maxUses : '') +
        '</td><td>' +
        button('revokeGrant', 'grant-revoke', g.id, 'subtle compact') +
        '</td></tr>',
    ),
    state.query ? noMatches() : empty('key', 'noGrants', 'noGrantsHint'),
    'page-table',
  );
}
function approvalsPage(s) {
  const tabs =
    '<div class="tabs"><button class="tab ' +
    (state.approvalTab === 'requests' ? 'active' : '') +
    '" data-action="approval-tab" data-id="requests" role="tab" aria-selected="' +
    (state.approvalTab === 'requests') +
    '">' +
    h(t('pending')) +
    ' <span class="tab-count">' +
    (s.pendingApprovals || []).length +
    '</span></button><button class="tab ' +
    (state.approvalTab === 'grants' ? 'active' : '') +
    '" data-action="approval-tab" data-id="grants" role="tab" aria-selected="' +
    (state.approvalTab === 'grants') +
    '">' +
    h(t('grants')) +
    ' <span class="tab-count">' +
    (s.activeGrants || []).length +
    '</span></button></div>';
  return (
    pageHead('approvals', 'approvalsDescription') +
    '<section class="panel">' +
    searchToolbar(
      state.approvalTab === 'requests' ? ['all', 'high', 'medium', 'low', 'reviewRisk'] : null,
      tabs,
    ) +
    '<div id="filtered-content">' +
    (state.approvalTab === 'requests' ? approvalTable(s, false) : grantsTable(s)) +
    '</div><footer class="panel-foot"><span class="row">' +
    icon('lock') +
    h(t('securityNote')) +
    '</span></footer></section>'
  );
}
function auditTable() {
  const items = state.audit.filter(
    (a) => matches(a) && (state.filter === 'all' || a.result === state.filter),
  );
  return table(
    ['operation', 'tool', 'actor', 'timestamp', 'result', ''],
    items.map(
      (a) =>
        '<tr><td><button class="project-link" data-action="audit-details" data-id="' +
        h(a.sequence) +
        '">' +
        rowTitle(a.operation || a.event || '—', a.capability) +
        '</button></td><td>' +
        h(a.tool || '—') +
        '</td><td>' +
        h(a.actorId || '—') +
        '</td><td class="nowrap">' +
        h(date(a.timestamp)) +
        '</td><td>' +
        badge(a.result) +
        '</td><td>' +
        more('audit-details', a.sequence) +
        '</td></tr>',
    ),
    state.query || state.filter !== 'all' ? noMatches() : empty('clock', 'noAudit', 'noAuditHint'),
    'page-table',
  );
}
function auditPage() {
  return (
    pageHead('audit', 'auditDescription', button('refresh', 'refresh', null, 'subtle', 'refresh')) +
    '<section class="panel">' +
    searchToolbar(['all', 'succeeded', 'failed', 'allowed', 'denied', 'pending']) +
    '<div id="filtered-content">' +
    auditTable() +
    '</div><footer class="panel-foot"><span>' +
    state.audit.length +
    ' ' +
    h(t('activity').toLowerCase()) +
    '</span><span>' +
    h(t('auditWindow')) +
    '</span></footer></section>'
  );
}
function filteredContent() {
  const s = state.status;
  if (!s) return;
  const target = document.getElementById('filtered-content');
  if (!target) return;
  const renderers = {
    projects: () => projectTable(s, false),
    jobs: () => jobsTable(s),
    sessions: () => sessionsTable(s),
    approvals: () => (state.approvalTab === 'requests' ? approvalTable(s, false) : grantsTable(s)),
    audit: auditTable,
    devices: () => {
      const d = deviceRecords(s).filter(matches);
      return d.length ? d.map(deviceCard).join('') : noMatches();
    },
  };
  if (renderers[state.page]) target.innerHTML = renderers[state.page]();
}
function skeletonPage() {
  return (
    '<div class="skeleton-hero"><div><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-line"></div></div></div><div class="metrics">' +
    Array.from(
      { length: 5 },
      () =>
        '<div class="skeleton-card"><div class="skeleton skeleton-icon"></div><div class="grow"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-number"></div></div></div>',
    ).join('') +
    '</div><div class="overview-top">' +
    Array.from(
      { length: 2 },
      () =>
        '<div class="skeleton-panel">' +
        Array.from({ length: 5 }, () => '<div class="skeleton skeleton-line"></div>').join('') +
        '</div>',
    ).join('') +
    '</div>'
  );
}
function renderPage(animate) {
  renderShell();
  const target = document.getElementById('page');
  const s = state.status;
  target.classList.toggle('page-enter', !!animate);
  const renderers = {
    overview: overviewPage,
    projects: projectsPage,
    devices: devicesPage,
    jobs: jobsPage,
    sessions: sessionsPage,
    approvals: approvalsPage,
    audit: auditPage,
    settings: settingsPage,
  };
  target.innerHTML =
    (!state.connected && s
      ? '<div class="offline-banner" role="status">' +
        icon('info') +
        h(t('reconnecting')) +
        '<span class="grow"></span>' +
        button('changeToken', 'connect-open', null, 'subtle compact') +
        '</div>'
      : '') + (s ? renderers[state.page](s) : skeletonPage());
}
`;
