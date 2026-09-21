/** Browser-side settings. Kept separate; assembled under the per-response CSP nonce. */
export const settingsSource = String.raw`
function settingRow(title, description, control) {
  return (
    '<div class="setting-row"><div><h3>' +
    h(t(title)) +
    '</h3>' +
    (description ? '<p>' + h(t(description)) + '</p>' : '') +
    '</div>' +
    control +
    '</div>'
  );
}
function settingValue(value) {
  return '<div class="setting-value">' + h(text(value)) + '</div>';
}
function choiceCards(name, values, selected, helps, icons) {
  return (
    '<div class="radio-cards">' +
    values
      .map(
        (v, i) =>
          '<label class="radio-card"><input type="radio" name="' +
          name +
          '" value="' +
          v +
          '"' +
          (selected === v ? ' checked' : '') +
          '>' +
          icon(icons[i]) +
          '<h3>' +
          h(t(v)) +
          '</h3><p>' +
          h(t(helps[i])) +
          '</p></label>',
      )
      .join('') +
    '</div>'
  );
}
function settingsCard(title, description, body) {
  return (
    '<section class="panel settings-card"><h2>' +
    h(t(title)) +
    '</h2><p class="description">' +
    h(t(description)) +
    '</p>' +
    body +
    '</section>'
  );
}
function settingsBody(s) {
  const d = s.device || {};
  const execution = s.execution || {};
  switch (state.settingsSection) {
    case 'general':
      return settingsCard(
        'general',
        'generalHelp',
        settingRow('connection', 'securityNote', badge(state.connected ? 'online' : 'offline')) +
          settingRow('device', null, settingValue(d.name)) +
          settingRow('version', null, settingValue(d.forgeBridgeVersion)) +
          settingRow('transport', null, settingValue(d.transport)) +
          settingRow(
            'platform',
            null,
            settingValue([s.platform?.os, s.platform?.architecture].filter(Boolean).join(' · ')),
          ) +
          settingRow('lastSeen', null, settingValue(date(d.lastSeen))),
      );
    case 'device':
      return settingsCard(
        'device',
        'renameHelp',
        '<form data-form="rename"><label class="field-label">' +
          h(t('deviceName')) +
          '<input class="field" name="name" value="' +
          h(d.name) +
          '" maxlength="128" required autocomplete="off"></label><div class="form-actions">' +
          button('rename', 'submit-rename', null, 'primary') +
          '</div></form><div class="divider"></div>' +
          detailGrid([
            ['hostname', d.hostname],
            ['id', d.id, 'mono'],
            ['created', date(d.createdAt)],
          ]) +
          settingRow(
            s.paused ? 'resume' : 'pause',
            'pauseHelp',
            button(
              s.paused ? 'resume' : 'pause',
              s.paused ? 'agent-resume' : 'agent-pause',
              null,
              'subtle',
              s.paused ? 'play' : 'pause',
            ),
          ),
      );
    case 'permissions':
      return settingsCard(
        'permissions',
        'permissionHelp',
        '<form data-form="mode">' +
          choiceCards(
            'mode',
            ['ask', 'balanced', 'full'],
            s.mode,
            ['askHelp', 'balancedHelp', 'fullHelp'],
            ['shield', 'sliders', 'checkCircle'],
          ) +
          '<div class="form-actions">' +
          button('save', 'submit-mode', null, 'primary') +
          '</div></form>' +
          notice('permissionHelp'),
      );
    case 'execution':
      return settingsCard(
        'execution',
        'executionHelp',
        '<form data-form="execution">' +
          choiceCards(
            'profile',
            ['normal', 'background', 'gaming'],
            execution.profile,
            ['normalHelp', 'backgroundProfileHelp', 'gamingHelp'],
            ['devices', 'moon', 'activity'],
          ) +
          '<div class="form-actions">' +
          button('apply', 'submit-execution', null, 'primary') +
          '</div></form>' +
          settingRow(
            'backgroundMode',
            'backgroundHelp',
            '<label class="switch"><input type="checkbox" data-field="background" ' +
              (execution.backgroundMode ? 'checked' : '') +
              ' aria-label="' +
              h(t('backgroundMode')) +
              '"><span>' +
              h(t(execution.backgroundMode ? 'enabled' : 'disabled')) +
              '</span></label>',
          ) +
          detailGrid([
            ['maxJobs', execution.maxParallelJobs],
            ['maxBrowsers', execution.maxBrowserInstances],
            ['cpuConcurrency', execution.maxCpuConcurrency],
            ['priority', execution.processPriority],
          ]) +
          '<div class="divider"></div><h3>' +
          h(t('foregroundActions')) +
          '</h3>' +
          foregroundList(s),
      );
    case 'projects':
      return settingsCard(
        'projects',
        'projectsDescription',
        projectTable(s, true) +
          '<div class="form-actions">' +
          button('addPolicy', 'project-edit', null, 'primary', 'plus') +
          '</div>',
      );
    case 'roots':
      return settingsCard(
        'roots',
        'rootsHelp',
        (s.roots || [])
          .map(
            (root) =>
              '<div class="root-card"><h3>' +
              h(root.path) +
              '</h3><div class="chip-list">' +
              (root.capabilities || [])
                .map((c) => '<span class="chip">' + h(c) + '</span>')
                .join('') +
              '</div></div>',
          )
          .join('') + notice('managedConfig'),
      );
    case 'security':
      return settingsCard(
        'security',
        'securityHelp',
        settingRow(
          'tokenLabel',
          'tokenStorage',
          button('changeToken', 'connect-open', null, 'subtle', 'key'),
        ) +
          settingRow('grants', 'noGrantsHint', button('details', 'grants-page', null, 'subtle')) +
          '<div class="divider"></div><h3>' +
          h(t('revoke')) +
          '</h3>' +
          notice('revokeHelp') +
          '<div class="form-actions">' +
          button('revoke', 'agent-revoke', null, 'danger', 'lock') +
          '</div>',
      );
    case 'appearance':
      return settingsCard(
        'appearance',
        'themeHelp',
        '<div class="radio-cards theme-options">' +
          ['dark', 'light', 'system']
            .map(
              (v) =>
                '<label class="radio-card"><input type="radio" name="theme" data-field="theme" value="' +
                v +
                '"' +
                (state.theme === v ? ' checked' : '') +
                '><div class="theme-preview ' +
                v +
                '" aria-hidden="true"></div><h3>' +
                h(t(v)) +
                '</h3></label>',
            )
            .join('') +
          '</div>' +
          note('savedLocally'),
      );
    case 'language':
      return settingsCard(
        'language',
        'languageHelp',
        '<div class="radio-cards">' +
          [
            ['en', 'English'],
            ['ru', 'Русский'],
          ]
            .map(
              ([v, label]) =>
                '<label class="radio-card"><input type="radio" name="language" data-field="language" value="' +
                v +
                '"' +
                (state.language === v ? ' checked' : '') +
                '>' +
                icon('language') +
                '<h3>' +
                label +
                '</h3><p>' +
                v.toUpperCase() +
                '</p></label>',
            )
            .join('') +
          '</div>' +
          note('savedLocally'),
      );
    case 'advanced':
      return settingsCard(
        'advanced',
        'advancedHelp',
        detailGrid([
          ['id', d.id, 'mono'],
          ['fingerprint', d.fingerprint, 'mono'],
          ['shell', s.platform?.shell?.name],
          ['platform', s.platform?.release],
        ]) +
          '<details><summary>' +
          h(t('showRaw')) +
          '</summary><pre class="raw">' +
          h(JSON.stringify(redact(s), null, 2)) +
          '</pre></details>',
      );
    default:
      return '';
  }
}
function foregroundList(s) {
  const items = s.execution?.foregroundActions || [];
  if (!items.length)
    return '<div class="notice">' + icon('checkCircle') + h(t('noForeground')) + '</div>';
  return items
    .map(
      (a) =>
        '<div class="root-card">' +
        rowTitle(
          [a.application, a.requestedAction].filter(Boolean).join(' · ') || a.id,
          a.reason || a.purpose,
        ) +
        '<div class="form-actions">' +
        ['approve', 'defer', 'cancel']
          .map(
            (response) =>
              '<button class="button ' +
              (response === 'approve' ? 'primary' : 'subtle') +
              '" data-action="foreground" data-id="' +
              h(a.id) +
              '" data-response="' +
              response +
              '">' +
              h(t(response)) +
              '</button>',
          )
          .join('') +
        '</div></div>',
    )
    .join('');
}
function settingsPage(s) {
  return (
    pageHead('settings', 'settingsDescription') +
    '<div class="settings-layout"><nav class="settings-nav" aria-label="' +
    h(t('settings')) +
    '">' +
    settingsSections
      .map(
        (section) =>
          '<button data-action="settings-section" data-id="' +
          section +
          '" class="' +
          (state.settingsSection === section ? 'active' : '') +
          '"' +
          (state.settingsSection === section ? ' aria-current="page"' : '') +
          '>' +
          icon(settingsIcons[section]) +
          h(t(section)) +
          '</button>',
      )
      .join('') +
    '</nav><div class="settings-pane" id="settings-pane">' +
    settingsBody(s) +
    '</div></div>'
  );
}
`;
