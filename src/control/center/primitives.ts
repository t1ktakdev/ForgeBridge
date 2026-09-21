/** Browser-side primitives. Kept separate; assembled under the per-response CSP nonce. */
export const primitivesSource = String.raw`
// All HTML data goes through h(); SVG paths and template markup are static.
const paths = {
  overview: '<path d="m3 10 9-7 9 7M5 9v11h5v-6h4v6h5V9"/>',
  projects: '<path d="M3 6a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v10H3z"/>',
  cube: '<path d="m12 3 9 5-9 5-9-5zM3 8v10l9 5 9-5V8M12 13v10"/>',
  devices: '<rect x="3" y="4" width="18" height="13" rx="1.5"/><path d="M8 21h8M12 17v4"/>',
  jobs: '<circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4z"/>',
  gear: '<path d="m10 3-1 3-3 1-3 2 1 3-1 3 3 2 3 1 1 3h4l1-3 3-1 3-2-1-3 1-3-3-2-3-1-1-3z"/><circle cx="12" cy="12" r="3"/>',
  sessions: '<path d="m4 6 6 6-6 6M12 19h8"/>',
  people:
    '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2zM16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5"/>',
  approvals: '<path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  shield: '<path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6z"/><path d="M12 8v5M12 16h.01"/>',
  audit: '<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6"/>',
  settings:
    '<path d="m10 3-1 3-3 1-3 2 1 3-1 3 3 2 3 1 1 3h4l1-3 3-1 3-2-1-3 1-3-3-2-3-1-1-3z"/><circle cx="12" cy="12" r="3"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/>',
  moon: '<path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z"/>',
  bell: '<path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5zM10 21h4"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  arrow: '<path d="M4 12h16m-5-5 5 5-5 5"/>',
  more: '<circle cx="12" cy="5" r=".8"/><circle cx="12" cy="12" r=".8"/><circle cx="12" cy="19" r=".8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 14 6M18 18a8 8 0 0 1-14-6"/>',
  browser: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18z"/>',
  activity: '<path d="M5 18v-6M12 18V5M19 18v-9"/>',
  branch:
    '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M6 7v10M18 7c0 6-12 2-12 10"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',
  key: '<circle cx="8" cy="9" r="5"/><path d="m12 13 8 8m-4-4 3-3m-6 0 3-3"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="m7 4 13 8-13 8z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  language: '<path d="M3 5h12M9 3v2M6 5c1 6 3 8 8 10M12 5c-1 6-3 8-8 10M14 21l4-11 4 11M15 18h6"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m6 9 3 3-3 3M12 16h5"/>',
  sliders: '<path d="M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6"/>',
  link: '<path d="m10 7 3-3a5 5 0 0 1 7 7l-3 3M14 17l-3 3a5 5 0 0 1-7-7l3-3M8 16l8-8"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v13h5"/>',
};
function icon(name) {
  return (
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' +
    (paths[name] || paths.info) +
    '</svg>'
  );
}
function logo() {
  return '<svg class="brand-logo" viewBox="0 0 52 46" aria-hidden="true"><defs><linearGradient id="logo-gold" x2=".8" y2="1"><stop stop-color="#ffe0a0"/><stop offset="1" stop-color="#edb557"/></linearGradient></defs><path fill="url(#logo-gold)" d="m3 36 15-17 11-4-7-6 5-5 8 1 8 12 7 21h-8l-6-20-6-10 2 10 8 20h-6l-8-16-9 5-10 10H3z"/><path fill="#ffe4b1" d="m24 8 5-4-3 9-8 5 6-10z"/><path fill="#b78138" d="m36 13 8 7 6 18-9-16z"/></svg>';
}
function h(value) {
  return String(value == null ? '' : value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}
function text(value) {
  return value === undefined || value === null || value === '' ? '—' : String(value);
}
function basename(value) {
  return (
    String(value || '')
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() || t('project')
  );
}
function shortId(value) {
  return value ? String(value).slice(0, 8) : '—';
}
function date(value) {
  const d = new Date(value);
  return value && Number.isFinite(d.getTime())
    ? d.toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' })
    : '—';
}
function relative(value) {
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return '—';
  const seconds = Math.round((ts - Date.now()) / 1000);
  if (Math.abs(seconds) < 45) return t('now');
  const unit = Math.abs(seconds) < 3600 ? 'minute' : Math.abs(seconds) < 86400 ? 'hour' : 'day';
  return new Intl.RelativeTimeFormat(locale(), { numeric: 'auto', style: 'short' }).format(
    Math.round(seconds / { minute: 60, hour: 3600, day: 86400 }[unit]),
    unit,
  );
}
function elapsed(item) {
  const start = Date.parse(item.startedAt || item.createdAt);
  if (!Number.isFinite(start)) return '—';
  const end = item.finishedAt ? Date.parse(item.finishedAt) : Date.now();
  if (!Number.isFinite(end)) return '—';
  const sec = Math.max(0, Math.floor((end - start) / 1000));
  const units = state.language === 'ru' ? ['ч', 'мин', 'с'] : ['h', 'm', 's'];
  return sec >= 3600
    ? Math.floor(sec / 3600) + units[0] + ' ' + Math.floor((sec % 3600) / 60) + units[1]
    : Math.floor(sec / 60) + units[1] + ' ' + (sec % 60) + units[2];
}
function tone(value) {
  if (
    ['succeeded', 'completed', 'ready', 'online', 'allowed', 'approved', 'low', 'active'].includes(
      value,
    )
  )
    return 'green';
  if (['failed', 'error', 'denied', 'critical', 'high', 'revoked'].includes(value)) return 'red';
  if (['pending', 'queued', 'paused', 'medium', 'running', 'deferred'].includes(value))
    return 'gold';
  return '';
}
function badge(value, label) {
  return '<span class="badge ' + tone(value) + '">' + h(label || t(value || 'unknown')) + '</span>';
}
function button(label, action, id, kind, ic) {
  return (
    '<button type="button" class="button ' +
    (kind || '') +
    '" data-action="' +
    h(action) +
    '"' +
    (id != null ? ' data-id="' + h(id) + '"' : '') +
    '>' +
    (ic ? icon(ic) : '') +
    h(t(label)) +
    '</button>'
  );
}
function more(action, id, label) {
  return (
    '<button type="button" class="icon-button" data-action="' +
    h(action) +
    '" data-id="' +
    h(id) +
    '" aria-label="' +
    h(t(label || 'details')) +
    '" title="' +
    h(t(label || 'details')) +
    '">' +
    icon('more') +
    '</button>'
  );
}
function link(page, label) {
  return (
    '<a class="link-button" href="#/' +
    page +
    '">' +
    h(t(label || 'viewAll')) +
    icon('arrow') +
    '</a>'
  );
}
function iconBox(name, color, small) {
  return (
    '<span class="icon-box ' +
    (color || '') +
    (small ? ' small' : '') +
    '">' +
    icon(name) +
    '</span>'
  );
}
function empty(kind, title, copy, compact, cta) {
  return (
    '<div class="empty ' +
    (compact ? 'compact ' : '') +
    (kind === 'checkCircle' ? 'green' : '') +
    '"><div class="empty-icon">' +
    icon(kind) +
    '</div><strong>' +
    h(t(title)) +
    '</strong><p>' +
    h(t(copy)) +
    '</p>' +
    (cta || '') +
    '</div>'
  );
}
function table(headers, rows, emptyHtml, cls) {
  return (
    '<div class="table-scroll"><table class="' +
    (cls || '') +
    '"><thead><tr>' +
    headers.map((x) => '<th scope="col">' + h(x ? t(x) : '') + '</th>').join('') +
    '</tr></thead><tbody>' +
    rows.join('') +
    '</tbody></table></div>' +
    (rows.length ? '' : emptyHtml)
  );
}

function panel(title, ic, content, page, extra, foot) {
  return (
    '<section class="panel"><header class="panel-head"><h2>' +
    icon(ic) +
    h(t(title)) +
    '</h2>' +
    (extra || '') +
    (page ? link(page) : '') +
    '</header><div class="panel-content">' +
    content +
    '</div>' +
    (foot ? '<footer class="panel-foot">' + foot + '</footer>' : '') +
    '</section>'
  );
}
function pageHead(title, description, actions) {
  return (
    '<div class="page-head"><div><div class="eyebrow">ForgeBridge / ' +
    h(t(title)) +
    '</div><h1>' +
    h(t(title)) +
    '</h1><p>' +
    h(t(description)) +
    '</p></div>' +
    (actions ? '<div class="head-actions">' + actions + '</div>' : '') +
    '</div>'
  );
}
function detailGrid(entries) {
  return (
    '<dl class="details-grid">' +
    entries
      .map(
        ([key, value, cls]) =>
          '<dt>' + h(t(key)) + '</dt><dd class="' + (cls || '') + '">' + h(text(value)) + '</dd>',
      )
      .join('') +
    '</dl>'
  );
}
function notice(key) {
  return '<div class="notice">' + icon('info') + '<span>' + h(t(key)) + '</span></div>';
}
function note(key) {
  return '<p class="page-note">' + icon('info') + h(t(key)) + '</p>';
}
function searchToolbar(filters, leading) {
  return (
    '<div class="toolbar">' +
    (leading || '') +
    '<label class="field-search">' +
    icon('search') +
    '<input data-field="query" type="search" aria-label="' +
    h(t('searchPage')) +
    '" placeholder="' +
    h(t('searchPage')) +
    '" value="' +
    h(state.query) +
    '"></label>' +
    (filters
      ? '<select class="select" data-field="filter" aria-label="' +
        h(t('filter')) +
        '">' +
        filters
          .map(
            (x) =>
              '<option value="' +
              h(x) +
              '"' +
              (state.filter === x ? ' selected' : '') +
              '>' +
              h(t(x)) +
              '</option>',
          )
          .join('') +
        '</select>'
      : '') +
    '</div>'
  );
}
function matches(item) {
  return (
    !state.query ||
    JSON.stringify(item)
      .toLocaleLowerCase(locale())
      .includes(state.query.toLocaleLowerCase(locale()))
  );
}
function noMatches() {
  return empty(
    'search',
    'noResults',
    'noResultsHint',
    false,
    button('clearFilters', 'clear-filters'),
  );
}
function rowTitle(title, sub) {
  return (
    '<div class="title truncate" title="' +
    h(title) +
    '">' +
    h(text(title)) +
    '</div>' +
    (sub ? '<div class="subtitle truncate" title="' + h(sub) + '">' + h(sub) + '</div>' : '')
  );
}
function sessionTabs(browserCount, terminalCount) {
  return (
    '<div class="tabs session-tabs" role="tablist" aria-label="' +
    h(t('sessions')) +
    '">' +
    ['browser', 'terminal']
      .map(
        (k) =>
          '<button type="button" role="tab" aria-selected="' +
          (state.sessionTab === k) +
          '" class="tab ' +
          (state.sessionTab === k ? 'active' : '') +
          '" data-action="session-tab" data-id="' +
          k +
          '">' +
          h(t(k + 'Sessions')) +
          '<span class="tab-count">' +
          (k === 'browser' ? browserCount : terminalCount) +
          '</span></button>',
      )
      .join('') +
    '</div>'
  );
}
function projectRecords(s) {
  const result = (s.projectProfiles || []).map((p) => ({ ...p, profile: true }));
  const active = s.device && s.device.activeProject;
  const normalize = (p) => (s.platform?.os === 'win32' ? String(p).toLowerCase() : String(p));
  if (active && !result.some((p) => normalize(p.root) === normalize(active)))
    result.unshift({ root: active, mode: s.mode, autonomy: 'standard', profile: false });
  return result;
}
// Explicit single-device adapter; a future devices[] response can be normalized here.
function deviceRecords(s) {
  return s.device
    ? [
        {
          ...s.device,
          platform: s.platform,
          mode: s.mode,
          paused: s.paused,
          execution: s.execution,
        },
      ]
    : [];
}
function activeTerminals(s) {
  return (s.terminalSessions || []).filter((x) => !x.status || x.status === 'running');
}
function browserTitle(item) {
  try {
    return new URL(item.pages?.[0]?.url).hostname || item.pages[0].url;
  } catch {
    return t(item.headless ? 'headless' : 'browser');
  }
}
function approvalProject(item) {
  return (
    item.projectRoot ||
    item.project ||
    (['path', 'repository'].includes(item.scope?.kind) ? item.scope.value : '')
  );
}
function risk(item) {
  const r = typeof item.risk === 'string' ? item.risk.toLowerCase() : item.risk?.level;
  return ['low', 'medium', 'high', 'critical'].includes(r) ? r : 'reviewRisk';
}
function projectActivity(root) {
  return state.audit.find((a) =>
    JSON.stringify([a.scope, a.arguments?.workingDirectory, a.arguments?.root])
      .toLowerCase()
      .includes(String(root).toLowerCase()),
  );
}
function jobTitle(j) {
  return j.label || j.command || j.type || t('backgroundJob');
}
// Defense in depth for display. No credential is ever added to a URL or to raw diagnostics.
function redact(value, key) {
  if (
    key &&
    /(authorization|cookie|password|passwd|secret|token|api.?key|private.?key|credential)/i.test(
      key,
    )
  )
    return '[REDACTED]';
  if (Array.isArray(value)) return value.map((x) => redact(x));
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]));
  if (typeof value === 'string')
    return value
      .replace(/(Bearer\s+)[\w.\-]+/gi, '$1[REDACTED]')
      .replace(/([?&](?:token|api_key|key|password|secret|code)=)[^&#\s]*/gi, '$1[REDACTED]')
      .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
      .replace(
        /((?:--?(?:password|token|api-key|secret)|(?:API_KEY|ACCESS_TOKEN|PASSWORD|SECRET))\s*[= ]\s*)(?:"[^"]*"|'[^']*'|[^\s;]+)/gi,
        '$1[REDACTED]',
      );
  return value;
}
function mountains() {
  // Layered ridges and fine facets retain depth at desktop scale without raster assets.
  const ridge = [
    [0, 150],
    [37, 134],
    [61, 120],
    [88, 97],
    [103, 90],
    [117, 97],
    [134, 79],
    [151, 87],
    [163, 73],
    [181, 68],
    [197, 57],
    [211, 63],
    [228, 52],
    [249, 47],
    [268, 53],
    [281, 60],
    [297, 59],
    [313, 73],
    [326, 70],
    [343, 79],
    [356, 76],
    [377, 84],
    [393, 96],
    [408, 92],
    [425, 106],
    [439, 99],
    [457, 110],
    [475, 117],
    [490, 115],
    [510, 137],
    [529, 149],
    [548, 155],
    [568, 158],
    [591, 156],
    [612, 139],
    [630, 147],
    [650, 131],
    [670, 123],
    [691, 124],
    [710, 106],
    [732, 103],
    [748, 108],
    [770, 117],
    [800, 114],
    [820, 99],
    [850, 96],
    [900, 121],
  ];
  let facets = '';
  for (let i = 3; i < ridge.length - 2; i++) {
    const [x, y] = ridge[i];
    const [nx, ny] = ridge[i + 1];
    const foot = x + 28 + ((i * 19) % 91);
    const shade = i % 3 === 0 ? '#8e8161' : i % 3 === 1 ? '#05090d' : '#667075';
    facets +=
      '<path d="M' +
      x +
      ' ' +
      y +
      ' ' +
      nx +
      ' ' +
      ny +
      ' ' +
      foot +
      ' 204 ' +
      (foot - 43) +
      ' 186Z" fill="' +
      shade +
      '" opacity="' +
      (i % 3 === 0 ? '.025' : '.07') +
      '"/>';
    if (i % 2 === 0)
      facets +=
        '<path d="M' +
        x +
        ' ' +
        y +
        ' ' +
        (x + 19) +
        ' ' +
        (y + 31) +
        ' ' +
        (x + 39) +
        ' ' +
        (y + 43) +
        ' ' +
        (x + 61) +
        ' 172" fill="none" stroke="#b7b3a2" stroke-width=".7" opacity=".065"/>';
  }
  return (
    '<div class="landscape" aria-hidden="true"><svg viewBox="0 0 900 210" preserveAspectRatio="none"><defs><radialGradient id="sky"><stop stop-color="#ae8040" stop-opacity=".48"/><stop offset=".6" stop-color="#6e5534" stop-opacity=".2"/><stop offset="1" stop-color="#0b1016" stop-opacity="0"/></radialGradient><linearGradient id="mount" x1="0" y1="0" x2=".6" y2="1"><stop stop-color="#20282d"/><stop offset=".5" stop-color="#10171d"/><stop offset="1" stop-color="#0b1016"/></linearGradient><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset=".6" stop-color="#0b1016" stop-opacity="0"/><stop offset="1" stop-color="#0b1016"/></linearGradient></defs><ellipse cx="650" cy="110" rx="355" ry="164" fill="url(#sky)"/><path d="M0 147 93 91 138 122 184 115 248 123 292 109 325 123 381 95 408 102 462 149 513 146 546 166 603 166 649 153 705 112 738 126 782 108 830 113 900 102V210H0Z" fill="#302d27" opacity=".45"/><path d="M' +
    ridge.map((p) => p.join(' ')).join('L') +
    'V210H0Z" fill="url(#mount)"/>' +
    facets +
    '<path d="M0 192 85 176 140 182 191 153 235 171 296 167 342 194 390 188 450 198 527 180 591 194 652 192 711 166 756 177 800 158 847 150 900 139V210H0Z" fill="#0c131a"/><rect width="900" height="210" fill="url(#fade)"/></svg></div>'
  );
}
`;
