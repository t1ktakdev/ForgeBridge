/** Shared design tokens, layout, components and reduced-motion behavior. */
export const controlStyles = String.raw`
:root {
  color-scheme: dark;
  --bg: #0b1016;
  --sidebar: #0d1218;
  --panel: #10171e;
  --panel-top: #131a22;
  --raised: #1b232c;
  --hover: rgba(179, 195, 212, 0.045);
  --line: rgba(163, 182, 204, 0.15);
  --line-soft: rgba(163, 182, 204, 0.095);
  --text: #edf0f5;
  --muted: #a0aec0;
  --dim: #718097;
  --gold: #f2c16e;
  --gold-text: #f5c775;
  --gold-soft: rgba(242, 193, 110, 0.11);
  --green: #67d78a;
  --green-soft: rgba(103, 215, 138, 0.09);
  --red: #f28e86;
  --red-soft: rgba(242, 142, 134, 0.1);
  --blue: #6cbce4;
  --shadow: 0 24px 80px #0007;
  --sidebar-width: 232px;
  --radius: 11px;
  --fast: 150ms;
  --normal: 220ms;
  --ease: cubic-bezier(0.2, 0.8, 0.2, 1);
  font-family:
    Inter,
    'Segoe UI',
    -apple-system,
    BlinkMacSystemFont,
    sans-serif;
  font-size: 13px;
  font-synthesis: none;
  background: var(--bg);
  color: var(--text);
}
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  background: radial-gradient(ellipse at 90% 0%, #54462e0b, transparent 48%), var(--bg);
  min-width: 360px;
}
button,
input,
select,
textarea {
  font: inherit;
}
button,
a,
input,
select,
textarea {
  -webkit-tap-highlight-color: transparent;
}
button {
  color: inherit;
  cursor: pointer;
}
a {
  color: inherit;
  text-decoration: none;
}
button {
  border: 0;
  background: none;
}
button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
button:active:not(:disabled) {
  transform: translateY(1px);
}
button,
input,
select,
a,
summary {
  outline-offset: 3px;
}
button:focus-visible,
input:focus-visible,
select:focus-visible,
a:focus-visible,
summary:focus-visible {
  outline: 2px solid var(--gold);
}
::selection {
  background: #f2c16e3a;
}
svg.icon {
  width: 20px;
  height: 20px;
  stroke: currentColor;
  fill: none;
  stroke-width: 1.65;
  stroke-linecap: round;
  stroke-linejoin: round;
  flex: none;
  vertical-align: middle;
}
h1,
h2,
h3,
p {
  margin: 0;
}
h1 {
  font-size: 26px;
  line-height: 1.3;
  font-weight: 650;
  letter-spacing: -0.7px;
}
h2 {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.15px;
}
h3 {
  font-size: 13px;
  font-weight: 600;
}
.muted {
  color: var(--muted);
}
.dim {
  color: var(--dim);
}
.small {
  font-size: 11px;
}
.mono {
  font-family: 'Cascadia Code', Consolas, monospace;
  font-size: 11px;
}
.truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.hidden,
[hidden] {
  display: none !important;
}
.gold {
  color: var(--gold-text);
}
.green {
  color: var(--green);
}
.red {
  color: var(--red);
}
.nowrap {
  white-space: nowrap;
}
.grow {
  flex: 1;
  min-width: 0;
}
.stack {
  display: grid;
  gap: 16px;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.wrap {
  flex-wrap: wrap;
}
.spread {
  justify-content: space-between;
}
.divider {
  height: 1px;
  background: var(--line-soft);
  margin: 18px 0;
}
.icon-box {
  width: 36px;
  height: 36px;
  border-radius: 9px;
  background: linear-gradient(145deg, #b7c5d210, #b7c5d208);
  display: grid;
  place-items: center;
  flex: none;
  color: #cad3e1;
}
.icon-box.gold {
  color: var(--gold);
  background: linear-gradient(145deg, #f2c16e19, #f2c16e09);
}
.icon-box.green {
  color: var(--green);
  background: var(--green-soft);
}
.icon-box.small {
  width: 30px;
  height: 30px;
  border-radius: 7px;
}
.icon-box.small .icon {
  width: 16px;
  height: 16px;
}
.dot {
  width: 7px;
  height: 7px;
  display: inline-block;
  flex: none;
  border-radius: 50%;
  background: var(--dim);
}
.dot.green {
  background: var(--green);
}
.dot.gold {
  background: var(--gold);
}
.dot.red {
  background: var(--red);
}
.sidebar {
  width: var(--sidebar-width);
  position: fixed;
  inset: 0 auto 0 0;
  z-index: 40;
  border-right: 1px solid var(--line);
  background: linear-gradient(135deg, #ffffff02, transparent 60%), var(--sidebar);
  padding: 24px 13px 22px;
  display: flex;
  flex-direction: column;
}
.brand {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 0 11px;
  margin-bottom: 32px;
}
.brand-logo {
  width: 44px;
  height: 40px;
  flex: none;
}
.brand-title {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.45px;
  line-height: 1.15;
}
.brand-subtitle {
  font-size: 12px;
  color: var(--muted);
  margin-top: 5px;
}
.nav {
  display: grid;
  gap: 5px;
}
.nav-link {
  position: relative;
  display: flex;
  align-items: center;
  gap: 19px;
  min-height: 45px;
  padding: 0 15px;
  border-radius: 9px;
  color: #b7c4d5;
  transition:
    background var(--normal),
    color var(--normal);
}
.nav-link:hover {
  background: var(--hover);
  color: var(--text);
}
.nav-link.active {
  background: linear-gradient(105deg, #f3d39913, #bec9dc0b);
  color: var(--text);
  font-weight: 600;
  box-shadow: inset 0 1px #ffffff03;
}
.nav-link::before {
  content: '';
  position: absolute;
  left: -13px;
  top: 8px;
  bottom: 8px;
  width: 3px;
  background: var(--gold);
  border-radius: 0 4px 4px 0;
  transform: scaleY(0);
  opacity: 0;
  transition:
    transform var(--normal) var(--ease),
    opacity var(--normal);
}
.nav-link.active::before {
  transform: scaleY(1);
  opacity: 1;
}
.nav-link .icon {
  width: 20px;
  height: 20px;
}
.nav-label {
  flex: 1;
}
.nav-badge {
  font-size: 10px;
  min-width: 21px;
  height: 20px;
  border-radius: 10px;
  background: var(--gold);
  color: #272014;
  display: grid;
  place-items: center;
  padding: 0 6px;
}
.sidebar-foot {
  margin-top: auto;
  padding: 16px 10px 0;
  border-top: 1px solid var(--line-soft);
}
.connection-button {
  width: 100%;
  padding: 4px 0;
  text-align: left;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.connection-button .dot.green {
  box-shadow: 0 0 0 5px #67d78a0e;
  animation: breathe 4s ease-in-out infinite;
}
.connection-version {
  padding: 8px 0 0 17px;
  color: var(--dim);
  font-size: 10px;
}
.sidebar-scrim {
  display: none;
}
.main {
  margin-left: var(--sidebar-width);
  padding: 18px 22px 24px;
  min-height: 100vh;
}
.topbar {
  height: 46px;
  display: flex;
  align-items: center;
  gap: 20px;
  position: relative;
  z-index: 25;
  margin-bottom: 15px;
}
.global-search {
  height: 43px;
  width: min(596px, 52%);
  position: relative;
  display: flex;
  align-items: center;
  gap: 11px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: linear-gradient(120deg, #ffffff04, #ffffff02), var(--panel);
  box-shadow: inset 0 1px #ffffff03;
  padding: 0 14px;
  transition:
    border var(--fast),
    box-shadow var(--fast);
}
.global-search:focus-within {
  border-color: #f2c16e6b;
  box-shadow: 0 0 0 3px #f2c16e08;
}
.global-search > .icon {
  color: var(--muted);
  width: 17px;
  height: 17px;
}
.global-search input {
  border: 0;
  background: none;
  width: 100%;
  color: var(--text);
  outline: 0 !important;
  min-width: 0;
  font-size: 12px;
}
.global-search input::placeholder {
  color: var(--muted);
}
kbd {
  font:
    10px 'Segoe UI',
    sans-serif;
  padding: 3px 5px;
  border-radius: 4px;
  background: #acbdd012;
  color: var(--muted);
  white-space: nowrap;
}
.top-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 12px;
}
.icon-button {
  width: 34px;
  height: 34px;
  border-radius: 7px;
  display: grid;
  place-items: center;
  position: relative;
  color: var(--muted);
  transition:
    background var(--fast),
    color var(--fast);
}
.icon-button:hover {
  background: var(--hover);
  color: var(--text);
}
.icon-button .icon {
  width: 19px;
  height: 19px;
}
.notification-dot {
  position: absolute;
  top: 4px;
  right: 5px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--gold);
  box-shadow: 0 0 0 2px var(--bg);
  animation: pop 0.3s var(--ease);
}
.language-switch {
  display: flex;
  border: 1px solid var(--line-soft);
  border-radius: 6px;
  padding: 2px;
  gap: 2px;
}
.language-switch button {
  padding: 4px 5px;
  font-size: 10px;
  border-radius: 4px;
  color: var(--dim);
}
.language-switch button.active {
  color: var(--text);
  background: var(--raised);
}
.profile-button {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 0 0 0 19px;
  border-left: 1px solid var(--line);
  max-width: 247px;
}
.avatar {
  height: 36px;
  width: 36px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: linear-gradient(135deg, #766f62, #4b4843);
  color: #fff3df;
  box-shadow: inset 0 1px #ffffff15;
  flex: none;
  font-size: 12px;
}
.profile-name {
  max-width: 154px;
  font-size: 12px;
}
.profile-button > .icon {
  width: 14px;
  height: 14px;
}
.mobile-menu {
  display: none;
}
.content {
  max-width: 1680px;
  margin: 0 auto;
}
.page-enter {
  animation: page-in 0.24s var(--ease);
}
.hero {
  height: 105px;
  position: relative;
  display: flex;
  align-items: center;
  margin-bottom: 14px;
  isolation: isolate;
  overflow: hidden;
}
.hero-copy {
  padding-left: 13px;
  position: relative;
  z-index: 2;
  max-width: 70%;
}
.hero h1 {
  font-size: 30px;
  letter-spacing: -0.75px;
  line-height: 1.15;
}
.hero h1 .greeting-name {
  display: inline-block;
  max-width: 460px;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: bottom;
  white-space: nowrap;
}
.hero p {
  font-size: 14px;
  line-height: 1.6;
  margin-top: 8px;
  color: var(--muted);
}
.hero-tagline {
  margin-left: auto;
  margin-right: 30px;
  font-size: 15px;
  line-height: 1.25;
  color: #c6bcaa;
  position: relative;
  z-index: 2;
  min-width: 122px;
}
.hero-tagline::after {
  content: '';
  display: block;
  margin-top: 9px;
  width: 40px;
  height: 2px;
  background: var(--gold);
  box-shadow: 0 0 9px #f2c16e30;
}
.landscape {
  position: absolute;
  inset: -30px -24px -6px 32%;
  z-index: 0;
  pointer-events: none;
  opacity: 0.86;
  mask-image: linear-gradient(90deg, transparent, #000 20%);
}
.landscape svg {
  width: 100%;
  height: 100%;
  display: block;
}
.metrics {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 15px;
}
.metric {
  position: relative;
  min-width: 0;
  height: 112px;
  text-align: left;
  display: flex;
  align-items: flex-start;
  gap: 17px;
  padding: 18px 15px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: linear-gradient(120deg, #ffffff02, transparent), var(--panel);
  box-shadow: inset 0 1px #ffffff02;
  transition:
    transform var(--normal) var(--ease),
    border-color var(--normal),
    background var(--normal);
}
.metric:hover {
  transform: translateY(-2px);
  border-color: #bac9de40;
  background: var(--panel-top);
}
.metric > .icon-box {
  width: 46px;
  height: 46px;
  border-radius: 13px;
}
.metric > .icon-box .icon {
  width: 24px;
  height: 24px;
}
.metric-copy {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
}
.metric-label {
  font-size: 12px;
  white-space: nowrap;
  color: var(--muted);
  line-height: 16px;
}
.metric-value {
  font-size: 24px;
  line-height: 24px;
  font-weight: 600;
  letter-spacing: -0.6px;
}
.metric-meta {
  font-size: 10.5px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  padding-right: 8px;
}
.metric-chevron {
  position: absolute;
  right: 12px;
  bottom: 18px;
  color: var(--muted);
}
.metric-chevron .icon {
  width: 13px;
  height: 13px;
}
.overview-top {
  display: grid;
  grid-template-columns: minmax(0, 40fr) minmax(0, 60fr);
  gap: 12px;
  margin-bottom: 13px;
}
.overview-bottom {
  display: grid;
  grid-template-columns: minmax(0, 1.13fr) minmax(0, 1fr) minmax(0, 0.98fr);
  gap: 13px;
}
.panel {
  min-width: 0;
  background: linear-gradient(130deg, #ffffff02, transparent 65%), var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
  box-shadow: inset 0 1px #ffffff02;
}
.panel-head {
  height: 55px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 18px;
}
.panel-head h2 {
  display: flex;
  align-items: center;
  gap: 13px;
  min-width: 0;
  white-space: nowrap;
  font-size: 14px;
}
.panel-head h2 > .icon {
  width: 19px;
  height: 19px;
}
.panel-head .link-button {
  margin-left: auto;
}
.link-button {
  color: var(--gold-text);
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  white-space: nowrap;
  padding: 6px 0;
}
.link-button .icon {
  width: 14px;
  height: 14px;
}
.link-button:hover {
  color: var(--text);
}
.panel-content {
  padding: 0 12px 10px;
}
.panel-foot {
  border-top: 1px solid var(--line-soft);
  padding: 11px 16px;
  display: flex;
  align-items: center;
  gap: 10px;
  justify-content: space-between;
  font-size: 10px;
  color: var(--dim);
}
.overview-top > .panel {
  display: flex;
  flex-direction: column;
  min-height: 243px;
}
.overview-top > .panel > .panel-content {
  flex: 1;
}
.overview-bottom > .panel {
  min-height: 240px;
}
.overview-bottom .panel-head {
  padding: 0 16px;
}
.overview-bottom .panel-head h2 {
  font-size: 13px;
  gap: 10px;
}
.overview-bottom .panel-head .link-button {
  font-size: 10px;
}
.table-scroll {
  overflow: auto;
  overscroll-behavior-x: contain;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
  text-align: left;
}
th {
  font-size: 10px;
  font-weight: 500;
  color: var(--muted);
  height: 33px;
  background: #bac9dc05;
  border-top: 1px solid var(--line-soft);
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
  padding: 0 12px;
}
th:first-child {
  border-radius: 6px 0 0 0;
}
td {
  padding: 9px 12px;
  height: 53px;
  border-bottom: 1px solid var(--line-soft);
  color: var(--muted);
  line-height: 1.4;
}
tbody tr:last-child td {
  border-bottom: 0;
}
tbody tr {
  transition: background var(--fast);
}
tbody tr:hover {
  background: var(--hover);
}
td:first-child {
  color: var(--text);
}
td .title {
  font-size: 12px;
  color: var(--text);
  font-weight: 500;
  max-width: 360px;
}
.subtitle {
  font-size: 10px;
  color: var(--dim);
  line-height: 1.6;
  margin-top: 2px;
  max-width: 360px;
}
.project-cell {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 170px;
}
.project-cell .subtitle {
  max-width: 260px;
}
.project-cell .title {
  color: var(--text);
}
.project-link {
  text-align: left;
  padding: 0;
  min-width: 0;
}
.project-link:hover .title {
  text-decoration: underline;
  text-decoration-color: var(--gold);
  text-underline-offset: 3px;
}
.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  padding: 4px 8px;
  border-radius: 6px;
  line-height: 1.2;
  white-space: nowrap;
  color: var(--muted);
  background: #a9b9cd09;
}
.badge.gold {
  color: var(--gold-text);
  background: var(--gold-soft);
}
.badge.green {
  color: var(--green);
  background: var(--green-soft);
}
.badge.red {
  color: var(--red);
  background: var(--red-soft);
}
.badge.blue {
  color: var(--blue);
  background: #6cbce413;
}
.badge.round {
  border-radius: 20px;
  padding: 6px 11px;
}
.button {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  gap: 7px;
  min-height: 32px;
  border: 1px solid var(--line);
  border-radius: 7px;
  padding: 6px 11px;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.35;
  background: linear-gradient(#ffffff03, transparent), var(--raised);
  box-shadow: inset 0 1px #ffffff025;
  white-space: nowrap;
  transition:
    background var(--fast),
    border var(--fast),
    transform var(--fast),
    opacity var(--fast);
}
.button .icon {
  width: 14px;
  height: 14px;
}
.button:hover {
  background: var(--panel-top);
  border-color: #b5c7df40;
}
.button.primary {
  background: linear-gradient(170deg, #f8cf89, #edb960);
  color: #251d10;
  border-color: #f8cf8970;
  box-shadow:
    inset 0 1px #ffe5b852,
    0 2px 5px #0002;
}
.button.primary:hover {
  filter: brightness(1.06);
}
.button.danger {
  background: var(--red-soft);
  border-color: #f28e8633;
  color: var(--red);
}
.button.subtle {
  background: transparent;
  box-shadow: none;
  border-color: var(--line-soft);
  color: var(--muted);
}
.button.full {
  width: 100%;
}
.button.busy::before {
  content: '';
  width: 12px;
  height: 12px;
  border: 1.5px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
.button.compact {
  min-height: 29px;
  font-size: 10px;
  padding: 5px 10px;
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 26px 20px;
  min-height: 156px;
}
.empty .empty-icon {
  width: 43px;
  height: 43px;
  margin-bottom: 12px;
  border: 1px solid var(--line);
  border-radius: 13px;
  display: grid;
  place-items: center;
  background: linear-gradient(145deg, #c8d7ee09, transparent);
  color: var(--dim);
  box-shadow: 0 5px 18px #0000000a;
}
.empty.green .empty-icon {
  color: var(--green);
  border-color: #67d78a23;
  background: var(--green-soft);
}
.empty strong {
  font-weight: 500;
  color: var(--text);
  font-size: 12px;
}
.empty p {
  font-size: 11px;
  line-height: 1.65;
  max-width: 300px;
  margin-top: 5px;
  color: var(--dim);
}
.empty .button {
  margin-top: 15px;
}
.empty.compact {
  min-height: 143px;
  padding: 15px;
}
.empty.compact .empty-icon {
  width: 35px;
  height: 35px;
  margin-bottom: 10px;
  border-radius: 10px;
}
.empty.compact .empty-icon .icon {
  width: 18px;
  height: 18px;
}
.empty-cell {
  padding: 0 !important;
}
.empty-cell .empty {
  min-height: 174px;
}
.page-head {
  display: flex;
  align-items: center;
  gap: 16px;
  margin: 30px 0 24px;
  min-height: 60px;
}
.page-head p {
  color: var(--muted);
  margin-top: 7px;
  line-height: 1.6;
  font-size: 12px;
}
.page-head .head-actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
}
.eyebrow {
  font-size: 10px;
  color: var(--dim);
  letter-spacing: 0.9px;
  text-transform: uppercase;
  margin-bottom: 9px;
}
.toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 13px 16px;
  border-bottom: 1px solid var(--line);
  min-height: 59px;
}
.field-search {
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--dim);
  flex: 1;
  max-width: 370px;
}
.field-search .icon {
  width: 16px;
  height: 16px;
}
.field-search input {
  width: 100%;
  background: transparent;
  border: 0;
  outline: 0;
  color: var(--text);
  height: 30px;
  font-size: 11px;
}
.field-search input::placeholder {
  color: var(--dim);
}
.field-search:focus-within {
  color: var(--gold);
}
.field,
.select {
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 7px;
  padding: 8px 10px;
  min-width: 0;
  font-size: 12px;
  min-height: 35px;
  transition: border-color var(--fast);
}
.field:focus,
.select:focus {
  border-color: var(--gold);
}
.select {
  max-width: 190px;
  min-height: 30px;
  font-size: 11px;
}
.toolbar .select {
  margin-left: auto;
}
.count-label {
  font-size: 10px;
  white-space: nowrap;
  color: var(--dim);
}
.page-table td {
  height: 61px;
}
.page-table th {
  height: 37px;
}
.page-table .empty {
  min-height: 240px;
}
.page-note {
  margin-top: 13px;
  color: var(--dim);
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 7px;
}
.page-note .icon {
  width: 13px;
  height: 13px;
}
.tabs {
  display: flex;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 3px;
  gap: 3px;
  background: #05090d20;
}
.tab {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex: 1;
  padding: 7px 12px;
  border-radius: 6px;
  color: var(--muted);
  font-size: 11px;
  white-space: nowrap;
  border-bottom: 1px solid transparent;
  transition:
    background var(--normal),
    color var(--normal),
    border-color var(--normal);
}
.tab.active {
  color: var(--text);
  background: linear-gradient(#c5d2e410, #c5d2e408);
  border-bottom-color: var(--gold);
  box-shadow: 0 1px 4px #0002;
}
.tab-count {
  font-size: 9px;
  background: #bccae112;
  padding: 2px 6px;
  border-radius: 8px;
}
.tab.active .tab-count {
  background: var(--gold-soft);
  color: var(--gold);
}
.session-tabs {
  margin: 0 0 6px;
}
.list-row {
  display: flex;
  align-items: center;
  gap: 11px;
  min-height: 48px;
  padding: 8px 5px;
  border-bottom: 1px solid var(--line-soft);
  transition: background var(--fast);
}
.list-row:last-child {
  border-bottom: 0;
}
.list-row:hover {
  background: var(--hover);
}
.list-row .row-main {
  min-width: 0;
  flex: 1;
}
.list-row .title {
  font-size: 11px;
  font-weight: 500;
}
.list-row .subtitle {
  font-size: 10px;
}
.progress-track {
  width: 70px;
  height: 4px;
  overflow: hidden;
  position: relative;
  border-radius: 3px;
  background: #bdcfe312;
  flex: none;
}
.progress-track.indeterminate::after {
  content: '';
  position: absolute;
  inset: 0 auto 0 -40%;
  width: 40%;
  border-radius: 3px;
  background: linear-gradient(90deg, var(--green), #65b5ad);
  animation: progress 1.7s ease-in-out infinite;
}
.progress-done {
  width: 15px;
  height: 15px;
  color: var(--green);
}
.timeline {
  padding: 1px 5px 0;
}
.timeline-row {
  position: relative;
  display: flex;
  gap: 12px;
  min-height: 44px;
  align-items: flex-start;
  padding: 5px 0;
}
.timeline-row::before {
  content: '';
  position: absolute;
  width: 1px;
  top: 22px;
  bottom: -6px;
  left: 5px;
  background: var(--line);
}
.timeline-row:last-child::before {
  display: none;
}
.timeline-marker {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: var(--blue);
  margin-top: 6px;
  flex: none;
  position: relative;
  z-index: 1;
  box-shadow: 0 0 0 3px var(--panel);
}
.timeline-marker.green {
  background: var(--green);
}
.timeline-marker.gold {
  background: var(--gold);
}
.timeline-marker.red {
  background: var(--red);
}
.timeline-row .title {
  font-size: 11px;
  font-weight: 500;
}
.timeline-row .subtitle {
  max-width: 190px;
}
.timeline-row time {
  margin-left: auto;
  font-size: 10px;
  color: var(--muted);
  padding-top: 4px;
  white-space: nowrap;
}
.timeline-row button.row-main {
  text-align: left;
  padding: 0;
  flex: 1;
  min-width: 0;
}
.timeline-row button:hover .title {
  color: var(--gold);
}
.device-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(290px, 0.55fr);
  gap: 16px;
}
.device-card {
  padding: 24px;
}
.device-visual {
  width: 70px;
  height: 60px;
  display: grid;
  place-items: center;
  color: #d5ddeb;
  background: linear-gradient(150deg, #cedcf014, transparent);
  border: 1px solid var(--line);
  border-radius: 13px;
}
.device-visual .icon {
  width: 37px;
  height: 37px;
}
.device-card h2 {
  font-size: 18px;
  letter-spacing: -0.3px;
}
.device-card .device-top {
  display: flex;
  gap: 19px;
  align-items: center;
  margin-bottom: 26px;
}
.details-grid {
  display: grid;
  grid-template-columns: 145px minmax(0, 1fr);
  gap: 0;
}
.details-grid dt,
.details-grid dd {
  margin: 0;
  padding: 11px 0;
  border-bottom: 1px solid var(--line-soft);
  line-height: 1.5;
  font-size: 11px;
  overflow-wrap: anywhere;
}
.details-grid dt {
  color: var(--dim);
  padding-right: 16px;
}
.details-grid dd {
  color: var(--text);
}
.details-grid dd.mono {
  font-size: 10.5px;
}
.device-actions {
  margin-top: 23px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.info-panel {
  padding: 22px;
}
.info-panel p {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.8;
  margin-top: 10px;
}
.info-panel .icon-box {
  margin-bottom: 18px;
}
.settings-layout {
  display: grid;
  grid-template-columns: 188px minmax(0, 1fr);
  gap: 25px;
  align-items: start;
}
.settings-nav {
  display: grid;
  gap: 3px;
  position: sticky;
  top: 24px;
}
.settings-nav button {
  text-align: left;
  font-size: 12px;
  color: var(--muted);
  border-radius: 7px;
  padding: 10px 12px;
  display: flex;
  gap: 11px;
  align-items: center;
  transition:
    background var(--fast),
    color var(--fast);
}
.settings-nav button .icon {
  width: 16px;
  height: 16px;
}
.settings-nav button:hover {
  background: var(--hover);
}
.settings-nav button.active {
  background: var(--gold-soft);
  color: var(--gold-text);
}
.settings-pane {
  max-width: 970px;
}
.settings-card {
  padding: 23px 24px;
}
.settings-card > h2 {
  font-size: 16px;
  margin-bottom: 8px;
}
.settings-card > .description {
  font-size: 12px;
  color: var(--muted);
  line-height: 1.75;
  max-width: 650px;
  margin-bottom: 25px;
}
.setting-row {
  display: flex;
  align-items: center;
  gap: 20px;
  min-height: 73px;
  padding: 16px 0;
  border-top: 1px solid var(--line-soft);
}
.setting-row > div:first-child {
  flex: 1;
  min-width: 0;
}
.setting-row p {
  font-size: 11px;
  color: var(--dim);
  line-height: 1.6;
  margin-top: 5px;
  max-width: 510px;
}
.setting-row h3 {
  font-size: 12px;
  font-weight: 500;
}
.setting-value {
  font-size: 12px;
  max-width: 50%;
  overflow-wrap: anywhere;
  text-align: right;
}
.radio-cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 11px;
  margin: 19px 0 21px;
}
.radio-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 15px;
  cursor: pointer;
  position: relative;
  transition:
    border var(--fast),
    background var(--fast);
  min-width: 0;
}
.radio-card input {
  position: absolute;
  right: 12px;
  top: 12px;
  accent-color: var(--gold);
}
.radio-card:has(input:checked) {
  border-color: #f2c16e73;
  background: var(--gold-soft);
}
.radio-card:has(input:focus-visible) {
  outline: 2px solid var(--gold);
  outline-offset: 2px;
}
.radio-card .icon {
  color: var(--muted);
  margin-bottom: 5px;
}
.radio-card h3 {
  font-size: 12px;
  font-weight: 500;
}
.radio-card p {
  font-size: 11px;
  color: var(--dim);
  line-height: 1.6;
}
.radio-card:has(input:checked) p {
  color: var(--muted);
}
.theme-preview {
  height: 75px;
  background: #0d131b;
  border: 1px solid #334051;
  display: flex;
  gap: 7px;
  padding: 8px;
  border-radius: 5px;
  margin: 8px 0 3px;
}
.theme-preview::before {
  content: '';
  width: 20%;
  border-radius: 2px;
  background: #24303e;
}
.theme-preview::after {
  content: '';
  flex: 1;
  border-radius: 2px;
  background: linear-gradient(
    #252d3a 17%,
    transparent 17%,
    transparent 28%,
    #1d2937 28%,
    #1d2937 57%,
    transparent 57%,
    transparent 64%,
    #1d2937 64%
  );
}
.theme-preview.light {
  background: #e9edf2;
  border-color: #b7c2cf;
}
.theme-preview.light::before {
  background: #c1ccd9;
}
.theme-preview.light::after {
  background: linear-gradient(
    #c1cddd 17%,
    transparent 17%,
    transparent 28%,
    #d3dce7 28%,
    #d3dce7 57%,
    transparent 57%,
    transparent 64%,
    #d3dce7 64%
  );
}
.theme-preview.system {
  background: linear-gradient(90deg, #0d131b 50%, #e9edf2 50%);
}
.chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 13px;
}
.chip {
  font-size: 10px;
  color: var(--muted);
  padding: 5px 8px;
  background: var(--raised);
  border: 1px solid var(--line-soft);
  border-radius: 5px;
}
.root-card {
  padding: 16px 0;
  border-top: 1px solid var(--line-soft);
}
.root-card h3 {
  font-family: Consolas, monospace;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.danger-zone {
  border-color: #f28e8628;
}
.switch {
  display: inline-flex;
  gap: 10px;
  align-items: center;
  position: relative;
  font-size: 11px;
  color: var(--muted);
  cursor: pointer;
}
.switch input {
  width: 34px;
  height: 18px;
  accent-color: var(--gold);
  cursor: pointer;
}
.form-stack {
  display: grid;
  gap: 17px;
}
.field-label {
  font-size: 11px;
  color: var(--muted);
  display: grid;
  gap: 7px;
}
.field-label .field {
  width: 100%;
}
.form-error {
  font-size: 11px;
  color: var(--red);
  line-height: 1.6;
}
.form-actions {
  display: flex;
  gap: 9px;
  justify-content: flex-end;
  margin-top: 23px;
  flex-wrap: wrap;
}
.form-actions .danger {
  margin-right: auto;
}
.notice {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  border: 1px solid var(--line);
  background: var(--hover);
  border-radius: 8px;
  padding: 12px;
  font-size: 11px;
  line-height: 1.7;
  color: var(--muted);
  margin: 17px 0;
}
.notice > .icon {
  width: 16px;
  height: 16px;
  color: var(--gold);
  margin-top: 2px;
}
.raw {
  font:
    11px/1.7 Consolas,
    monospace;
  max-height: 380px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 7px;
  padding: 14px;
  color: var(--muted);
}
details {
  border-top: 1px solid var(--line);
  padding-top: 15px;
  margin-top: 15px;
}
summary {
  cursor: pointer;
  font-size: 12px;
  color: var(--muted);
}
details[open] > .raw {
  animation: page-in 0.2s var(--ease);
}
.popover {
  position: absolute;
  z-index: 55;
  right: 0;
  top: 53px;
  width: 330px;
  padding: 8px;
  background: var(--panel-top);
  border: 1px solid var(--line);
  border-radius: 11px;
  box-shadow: var(--shadow);
  animation: dropdown 0.16s var(--ease);
  transform-origin: top right;
}
.popover-head {
  padding: 11px 10px 13px;
  font-size: 12px;
  font-weight: 600;
  border-bottom: 1px solid var(--line-soft);
}
.popover button.menu-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
  padding: 11px 10px;
  border-radius: 6px;
  color: var(--muted);
  font-size: 12px;
}
.popover button.menu-item:hover {
  background: var(--hover);
  color: var(--text);
}
.popover button.menu-item .icon {
  width: 16px;
  height: 16px;
}
.popover.profile-menu {
  width: 240px;
}
.search-popover {
  left: 0;
  right: auto;
  top: 48px;
  width: min(596px, 80vw);
  max-height: 440px;
  overflow: auto;
}
.search-result {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 10px;
  border-radius: 6px;
  width: 100%;
  text-align: left;
}
.search-result:hover {
  background: var(--hover);
}
.search-result strong {
  font-size: 12px;
  font-weight: 500;
  display: block;
}
.search-result small {
  display: block;
  font-size: 10px;
  color: var(--dim);
  margin-top: 3px;
  max-width: 450px;
}
.search-group {
  font-size: 9px;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: var(--dim);
  padding: 13px 10px 5px;
}
.overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px;
  background: #03070bc4;
  backdrop-filter: blur(4px);
  opacity: 0;
  visibility: hidden;
  transition:
    opacity var(--normal),
    visibility var(--normal);
}
.overlay.open {
  opacity: 1;
  visibility: visible;
}
.dialog {
  position: relative;
  width: min(530px, 100%);
  max-height: calc(100dvh - 56px);
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--panel-top);
  box-shadow: var(--shadow);
  transform: translateY(12px) scale(0.985);
  transition: transform var(--normal) var(--ease);
  padding: 25px;
}
.overlay.open .dialog {
  transform: translateY(0) scale(1);
}
.dialog-head {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 23px;
}
.dialog-head h2 {
  font-size: 19px;
  letter-spacing: -0.35px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.dialog-head p {
  font-size: 11px;
  color: var(--muted);
  line-height: 1.7;
  margin-top: 7px;
}
.dialog-head .icon-button {
  margin: -8px -9px 0 auto;
  flex: none;
}
.overlay.drawer-overlay {
  justify-content: flex-end;
  padding: 12px;
  background: #03070b93;
}
.drawer-overlay .dialog {
  width: 486px;
  height: calc(100dvh - 24px);
  max-height: none;
  transform: translateX(35px);
  border-radius: 13px;
  padding: 25px;
  display: flex;
  flex-direction: column;
}
.drawer-overlay.open .dialog {
  transform: translateX(0);
}
.drawer-overlay .dialog-body {
  overflow: auto;
  min-height: 0;
  flex: 1;
  padding-right: 2px;
}
.drawer-overlay .form-actions {
  border-top: 1px solid var(--line);
  padding-top: 19px;
}
.drawer-identity {
  display: flex;
  align-items: center;
  gap: 13px;
  padding: 14px 0 22px;
}
.drawer-identity .icon-box {
  width: 44px;
  height: 44px;
}
.drawer-identity h3 {
  font-size: 15px;
}
.toast-stack {
  position: fixed;
  z-index: 120;
  bottom: 24px;
  right: 24px;
  display: grid;
  gap: 9px;
  max-width: 380px;
  pointer-events: none;
}
.toast {
  display: flex;
  gap: 11px;
  align-items: center;
  font-size: 12px;
  padding: 14px 17px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: var(--panel-top);
  box-shadow: var(--shadow);
  animation: toast-in 0.25s var(--ease);
  transition:
    opacity 0.18s,
    transform 0.18s;
}
.toast > .icon {
  color: var(--green);
  width: 18px;
  height: 18px;
}
.toast.error > .icon {
  color: var(--red);
}
.toast.leaving {
  opacity: 0;
  transform: translateY(8px);
}
.connect-overlay {
  z-index: 100;
}
.connect-card {
  padding: 32px;
  max-width: 445px;
}
.connect-card .brand {
  padding: 0;
  margin: 0 0 30px;
}
.connect-card h2 {
  font-size: 22px;
  letter-spacing: -0.5px;
}
.connect-card p {
  font-size: 12px;
  color: var(--muted);
  line-height: 1.75;
  margin: 10px 0 24px;
}
.connect-card .button {
  width: 100%;
  margin-top: 18px;
  height: 36px;
}
.connect-card .token-note {
  font-size: 10px;
  color: var(--dim);
  margin: 17px 0 0;
}
.offline-banner {
  display: flex;
  align-items: center;
  gap: 9px;
  border: 1px solid #f2c16e33;
  background: var(--gold-soft);
  color: var(--gold);
  font-size: 11px;
  padding: 10px 14px;
  border-radius: 8px;
  margin: 17px 0;
}
.skeleton {
  background: linear-gradient(100deg, var(--raised) 30%, #bccfe017 45%, var(--raised) 60%);
  background-size: 220% 100%;
  animation: shimmer 1.7s linear infinite;
  border-radius: 6px;
}
.skeleton-card {
  height: 112px;
  border: 1px solid var(--line);
  border-radius: 11px;
  padding: 20px;
  display: flex;
  gap: 16px;
}
.skeleton-icon {
  width: 44px;
  height: 44px;
}
.skeleton-text {
  width: 80%;
  height: 12px;
  margin-bottom: 14px;
}
.skeleton-number {
  width: 32px;
  height: 23px;
}
.skeleton-panel {
  height: 240px;
  border: 1px solid var(--line);
  padding: 20px;
  border-radius: 11px;
}
.skeleton-line {
  height: 12px;
  margin: 16px 0;
  width: 90%;
}
.skeleton-line:nth-child(2n) {
  width: 65%;
}
.skeleton-hero {
  height: 105px;
  margin-bottom: 14px;
  display: flex;
  align-items: center;
}
.skeleton-hero > div {
  width: 400px;
}
.footer-line {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  margin-top: 18px;
  font-size: 10px;
  color: var(--dim);
  padding: 0 2px;
}
.footer-line .row {
  gap: 6px;
}
.footer-line .dot {
  width: 5px;
  height: 5px;
}
@keyframes progress {
  0% {
    left: -40%;
  }
  100% {
    left: 100%;
  }
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes page-in {
  from {
    opacity: 0;
    transform: translateY(5px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@keyframes dropdown {
  from {
    opacity: 0;
    transform: translateY(-5px) scale(0.985);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@keyframes shimmer {
  to {
    background-position: -220% 0;
  }
}
@keyframes breathe {
  50% {
    box-shadow: 0 0 0 5px #67d78a03;
  }
}
@keyframes pop {
  from {
    transform: scale(0.5);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}
:root[data-theme='light'] {
  color-scheme: light;
  --bg: #f0f3f6;
  --sidebar: #f8f9fb;
  --panel: #fff;
  --panel-top: #f8fafc;
  --raised: #edf1f5;
  --hover: rgba(35, 55, 79, 0.04);
  --line: rgba(48, 69, 96, 0.16);
  --line-soft: rgba(48, 69, 96, 0.1);
  --text: #182536;
  --muted: #596a80;
  --dim: #758497;
  --gold: #b87924;
  --gold-text: #95621d;
  --gold-soft: #b8792410;
  --green: #228049;
  --green-soft: #2280490c;
  --red: #c24945;
  --red-soft: #c249450e;
  --blue: #287aaa;
  --shadow: 0 20px 70px #24334c20;
}
:root[data-theme='light'] .nav-link {
  color: var(--muted);
}
:root[data-theme='light'] .nav-link.active {
  color: var(--text);
  background: linear-gradient(100deg, #b8792414, #b8792408);
}
:root[data-theme='light'] .icon-box {
  color: var(--muted);
  background: var(--raised);
}
:root[data-theme='light'] .icon-box.gold {
  color: var(--gold-text);
  background: var(--gold-soft);
}
:root[data-theme='light'] .icon-box.green {
  color: var(--green);
  background: var(--green-soft);
}
:root[data-theme='light'] .landscape {
  opacity: 0.25;
}
:root[data-theme='light'] .hero-tagline {
  color: #69573b;
}
:root[data-theme='light'] .device-visual {
  color: var(--muted);
}
:root[data-theme='light'] .button.primary {
  color: #322312;
  background: linear-gradient(#f8d28e, #edc37c);
}
:root[data-theme='light'] .overlay {
  background: #26344870;
}
:root[data-theme='light'] .tabs {
  background: #50617b06;
}
@media (min-width: 1700px) {
  .main {
    padding: 22px 27px;
  }
  .hero {
    height: 117px;
  }
  .overview-top > .panel {
    min-height: 270px;
  }
  .overview-bottom > .panel {
    min-height: 263px;
  }
  .metric {
    height: 119px;
    padding: 20px;
  }
  .overview-top .empty {
    min-height: 157px;
  }
  .overview-bottom .empty {
    min-height: 167px;
  }
  .hero h1 {
    font-size: 32px;
  }
}
@media (max-width: 1439px) {
  :root {
    --sidebar-width: 210px;
  }
  .brand {
    gap: 9px;
    padding: 0 7px;
  }
  .brand-logo {
    width: 37px;
  }
  .brand-title {
    font-size: 18px;
  }
  .main {
    padding: 16px 18px;
  }
  .nav-link {
    gap: 15px;
  }
  .top-actions {
    gap: 6px;
  }
  .profile-button {
    padding-left: 12px;
  }
  .profile-name {
    max-width: 120px;
    font-size: 11px;
  }
  .metric {
    padding: 17px 12px;
    gap: 12px;
  }
  .metric > .icon-box {
    width: 37px;
    height: 40px;
    border-radius: 10px;
  }
  .metric > .icon-box .icon {
    width: 21px;
  }
  .metric-label {
    font-size: 11px;
  }
  .metric-meta {
    font-size: 10px;
  }
  .hero h1 {
    font-size: 28px;
  }
  .hero h1 .greeting-name {
    max-width: 330px;
  }
  .hero p {
    font-size: 12px;
  }
  .hero-tagline {
    font-size: 13px;
    margin-right: 16px;
    min-width: 105px;
  }
  .panel-head {
    padding: 0 13px;
  }
  .panel-head h2 {
    font-size: 13px;
    gap: 10px;
  }
  .panel-content {
    padding: 0 10px 9px;
  }
  .overview-bottom {
    gap: 11px;
    grid-template-columns: 1.08fr 1fr 1fr;
  }
  .overview-bottom .panel-head {
    padding: 0 12px;
  }
  .overview-bottom .panel-head h2 {
    font-size: 12px;
    gap: 7px;
  }
  .overview-bottom .panel-head h2 .icon {
    width: 17px;
  }
  .overview-bottom .link-button {
    gap: 3px;
  }
  .overview-top {
    grid-template-columns: minmax(0, 39fr) minmax(0, 61fr);
  }
  .overview-top td {
    padding: 8px;
  }
  .overview-top th {
    padding: 0 8px;
  }
  .overview-top .project-cell {
    gap: 8px;
    min-width: 120px;
  }
  .overview-top .project-cell .subtitle {
    max-width: 140px;
  }
  .overview-top .project-cell .icon-box {
    width: 31px;
    height: 33px;
  }
  .overview-top .project-cell .title {
    font-size: 11px;
  }
  .overview-top .badge {
    font-size: 9px;
  }
  .overview-bottom .tab {
    font-size: 10px;
    padding: 7px 5px;
  }
  .timeline-row {
    gap: 8px;
  }
  .timeline-row .icon-box {
    display: none;
  }
  .timeline-row time {
    font-size: 9px;
  }
  .hero-copy {
    padding-left: 8px;
  }
  .settings-layout {
    grid-template-columns: 170px minmax(0, 1fr);
    gap: 20px;
  }
  .settings-card {
    padding: 22px;
  }
  .details-grid {
    grid-template-columns: 130px minmax(0, 1fr);
  }
}
@media (max-width: 1199px) {
  :root {
    --sidebar-width: 188px;
  }
  .brand-title {
    font-size: 16px;
  }
  .brand-logo {
    width: 31px;
  }
  .brand-subtitle {
    font-size: 10px;
  }
  .nav-link {
    gap: 12px;
    padding: 0 12px;
    font-size: 12px;
  }
  .profile-name {
    display: none;
  }
  .global-search {
    width: 57%;
  }
  .metric {
    gap: 9px;
    padding: 15px 10px;
    height: 105px;
  }
  .metric > .icon-box {
    width: 29px;
    height: 34px;
  }
  .metric > .icon-box .icon {
    width: 18px;
  }
  .metric-meta {
    font-size: 9px;
  }
  .hero h1 {
    font-size: 25px;
  }
  .hero h1 .greeting-name {
    max-width: 285px;
  }
  .overview-top {
    grid-template-columns: 1fr;
  }
  .overview-top > .panel {
    min-height: 200px;
  }
  .overview-top .project-cell .subtitle {
    max-width: 330px;
  }
  .overview-bottom {
    grid-template-columns: 1fr 1fr;
  }
  .overview-bottom > .panel:last-child {
    grid-column: 1/-1;
    min-height: 170px;
  }
  .overview-bottom > .panel:last-child .empty {
    min-height: 105px;
  }
  .overview-top .empty {
    min-height: 120px;
  }
  .device-grid {
    grid-template-columns: 1fr;
  }
  .settings-layout {
    gap: 14px;
    grid-template-columns: 155px minmax(0, 1fr);
  }
  .radio-cards {
    gap: 8px;
  }
  .radio-card {
    padding: 12px;
  }
  .hero-tagline {
    margin-right: 8px;
    min-width: 100px;
  }
  .topbar {
    gap: 12px;
  }
  .metrics {
    gap: 8px;
  }
  .hero p {
    font-size: 11px;
  }
}
@media (max-width: 900px) {
  :root {
    --sidebar-width: 68px;
  }
  .sidebar {
    padding: 20px 9px;
  }
  .brand {
    padding: 0 5px;
    margin-bottom: 26px;
  }
  .brand-logo {
    width: 32px;
  }
  .brand > div,
  .nav-label,
  .nav-link .nav-badge,
  .sidebar-foot .connection-version,
  .sidebar-foot .status-text,
  .sidebar-foot .icon {
    display: none;
  }
  .nav-link {
    justify-content: center;
    padding: 0;
    min-height: 43px;
  }
  .nav-link::before {
    left: -9px;
  }
  .sidebar-foot {
    padding: 18px 0 0;
  }
  .connection-button {
    justify-content: center;
  }
  .nav-link .icon {
    width: 21px;
  }
  .main {
    padding: 15px 18px;
  }
  .hero h1 {
    font-size: 27px;
  }
  .metric > .icon-box {
    display: none;
  }
  .metric {
    padding: 16px;
    height: 107px;
  }
  .metric-label {
    font-size: 11px;
  }
  .metric-meta {
    font-size: 10px;
  }
  .metric-value {
    font-size: 25px;
  }
  .hero-copy {
    max-width: 75%;
  }
  .hero h1 .greeting-name {
    max-width: 350px;
  }
  .hero-tagline {
    font-size: 12px;
  }
  .page-head {
    margin-top: 25px;
  }
  .settings-card {
    padding: 20px;
  }
  .top-actions {
    gap: 8px;
  }
}
@media (max-width: 640px) {
  :root {
    --sidebar-width: 0px;
  }
  .main {
    margin: 0;
    padding: 13px 14px 22px;
  }
  .sidebar {
    width: 220px;
    transform: translateX(-100%);
    transition: transform var(--normal) var(--ease);
    padding: 23px 13px;
  }
  .sidebar.mobile-open {
    transform: none;
  }
  .sidebar.mobile-open .brand > div,
  .sidebar.mobile-open .nav-label,
  .sidebar.mobile-open .sidebar-foot .connection-version,
  .sidebar.mobile-open .sidebar-foot .status-text {
    display: block;
  }
  .sidebar.mobile-open .nav-link {
    justify-content: flex-start;
    padding: 0 15px;
    gap: 16px;
  }
  .sidebar.mobile-open .nav-link .nav-badge {
    display: grid;
  }
  .sidebar.mobile-open .nav-link::before {
    left: -13px;
  }
  .sidebar.mobile-open .brand {
    margin-bottom: 29px;
  }
  .sidebar.mobile-open .connection-button {
    justify-content: flex-start;
  }
  .sidebar.mobile-open .brand-title {
    font-size: 19px;
  }
  .sidebar.mobile-open .brand-subtitle {
    font-size: 11px;
  }
  .sidebar.mobile-open ~ .sidebar-scrim {
    display: block;
    position: fixed;
    inset: 0;
    background: #0008;
    z-index: 35;
  }
  .mobile-menu {
    display: grid;
    flex: none;
  }
  .topbar {
    gap: 8px;
    margin-bottom: 12px;
  }
  .global-search {
    flex: 1;
    width: auto;
    height: 37px;
    padding: 0 10px;
    gap: 7px;
  }
  .global-search input {
    font-size: 11px;
  }
  .global-search kbd {
    display: none;
  }
  .top-actions {
    gap: 4px;
  }
  .top-actions > .language-switch {
    display: none;
  }
  .profile-button {
    border: 0;
    padding-left: 3px;
    gap: 0;
  }
  .profile-button > .icon {
    display: none;
  }
  .avatar {
    width: 29px;
    height: 29px;
  }
  .top-actions > .icon-button {
    width: 28px;
  }
  .hero {
    height: 117px;
    margin-bottom: 12px;
  }
  .hero-copy {
    padding-left: 0;
    max-width: 100%;
  }
  .hero h1 {
    font-size: 25px;
    max-width: 100%;
  }
  .hero h1 .greeting-name {
    max-width: 300px;
  }
  .hero p {
    font-size: 11px;
    max-width: 310px;
    line-height: 1.8;
  }
  .hero-tagline {
    display: none;
  }
  .landscape {
    inset: -5px -20px -5px 15%;
    opacity: 0.5;
  }
  .metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .metric {
    height: 97px;
    padding: 14px;
    flex-direction: row;
    gap: 12px;
  }
  .metric > .icon-box {
    display: grid;
    width: 35px;
    height: 37px;
  }
  .metric:last-child {
    grid-column: 1/-1;
    height: 74px;
    align-items: center;
  }
  .metric:last-child .metric-copy {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 5px 12px;
    flex: 1;
  }
  .metric:last-child .metric-meta {
    grid-column: 1/3;
  }
  .metric:last-child .metric-value {
    grid-column: 2;
    grid-row: 1/3;
    align-self: center;
    margin-right: 15px;
  }
  .metric-chevron {
    bottom: 17px;
  }
  .overview-bottom {
    grid-template-columns: 1fr;
    gap: 12px;
  }
  .overview-bottom > .panel:last-child {
    grid-column: auto;
  }
  .overview-bottom > .panel {
    min-height: 205px;
  }
  .overview-bottom .panel-head h2 {
    font-size: 14px;
  }
  .overview-top > .panel {
    min-height: 214px;
  }
  .panel-content {
    padding: 0 10px 10px;
  }
  .overview-top table {
    min-width: 510px;
  }
  .overview-top > .panel:first-child table {
    min-width: 380px;
  }
  .panel-head {
    height: 53px;
  }
  .panel-head h2 {
    font-size: 14px;
  }
  .page-head {
    align-items: flex-start;
    margin: 23px 0 20px;
    flex-wrap: wrap;
    gap: 15px;
  }
  .page-head h1 {
    font-size: 25px;
  }
  .page-head .head-actions {
    margin-left: 0;
  }
  .page-head p {
    font-size: 11px;
  }
  .toolbar {
    padding: 10px 12px;
    gap: 8px;
    flex-wrap: wrap;
  }
  .toolbar .tabs {
    flex: 1;
  }
  .toolbar .select {
    max-width: 135px;
  }
  .field-search {
    min-width: 140px;
    max-width: none;
  }
  .page-table {
    min-width: 660px;
  }
  .settings-layout {
    display: block;
  }
  .settings-nav {
    position: static;
    display: flex;
    overflow: auto;
    padding-bottom: 9px;
    margin-bottom: 15px;
    gap: 5px;
  }
  .settings-nav button {
    flex: none;
    padding: 9px 11px;
    border: 1px solid var(--line-soft);
    font-size: 11px;
    white-space: nowrap;
  }
  .settings-nav button .icon {
    width: 14px;
    height: 14px;
  }
  .settings-card {
    padding: 18px;
  }
  .radio-cards {
    grid-template-columns: 1fr;
  }
  .radio-card {
    display: grid;
    grid-template-columns: 23px 1fr;
    gap: 6px 12px;
    padding: 14px;
  }
  .radio-card h3 {
    grid-column: 2;
  }
  .radio-card p {
    grid-column: 2;
  }
  .radio-card > .icon {
    grid-column: 1;
    grid-row: 1/3;
    margin-top: 2px;
  }
  .theme-options {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .theme-options .radio-card {
    display: flex;
    padding: 10px;
    gap: 9px;
  }
  .theme-options .radio-card h3 {
    font-size: 11px;
  }
  .theme-preview {
    width: 100%;
    height: 50px;
    margin-top: 13px;
  }
  .setting-row {
    align-items: flex-start;
    gap: 12px;
    flex-wrap: wrap;
  }
  .setting-value {
    max-width: 60%;
    font-size: 11px;
  }
  .device-card {
    padding: 20px;
  }
  .device-card h2 {
    font-size: 16px;
  }
  .device-visual {
    width: 53px;
    height: 51px;
  }
  .device-visual .icon {
    width: 29px;
  }
  .details-grid {
    grid-template-columns: 120px 1fr;
  }
  .overlay {
    padding: 15px;
  }
  .dialog {
    padding: 21px;
    max-height: calc(100dvh - 30px);
  }
  .overlay.drawer-overlay {
    padding: 0;
  }
  .drawer-overlay .dialog {
    width: 100%;
    height: 100dvh;
    border-radius: 0;
    border: 0;
    padding: 22px;
  }
  .dialog-head h2 {
    font-size: 18px;
  }
  .connect-card {
    padding: 26px;
  }
  .toast-stack {
    bottom: 14px;
    right: 14px;
    left: 14px;
    max-width: none;
  }
  .popover {
    width: min(330px, calc(100vw - 28px));
  }
  .search-popover {
    position: fixed;
    top: 61px;
    left: 14px;
    width: calc(100vw - 28px);
  }
  .footer-line {
    font-size: 9px;
  }
  .footer-line > span:last-child {
    display: none;
  }
  .tabs .tab {
    padding: 7px 8px;
  }
  .session-tabs .tab {
    font-size: 11px;
  }
  .form-actions {
    gap: 7px;
  }
  .form-actions .button {
    flex: 1;
  }
  .form-actions .danger {
    margin-right: 0;
  }
  .page-note {
    line-height: 1.6;
  }
}
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
  .progress-track.indeterminate::after {
    left: 20%;
    width: 60%;
    opacity: 0.65;
  }
}

/* Final desktop hierarchy: compact, with legible data and restrained landscape contrast. */
@media (min-width: 1200px) {
  .nav-link {
    font-size: 13px;
  }
  .metric-label {
    font-size: 13px;
  }
  .metric-meta {
    font-size: 11px;
  }
  .metric {
    gap: 16px;
  }
  .panel-head h2 {
    font-size: 15px;
  }
  .overview-bottom .panel-head h2 {
    font-size: 14px;
  }
  .panel-head .link-button {
    font-size: 12px;
  }
  .overview-bottom .panel-head .link-button {
    font-size: 11px;
  }
  table {
    font-size: 12px;
  }
  th {
    font-size: 11px;
  }
  td .title {
    font-size: 13px;
  }
  .subtitle {
    font-size: 11px;
  }
  .badge {
    font-size: 11px;
  }
  .overview-top > .panel {
    min-height: 254px;
  }
  .overview-bottom > .panel {
    min-height: 243px;
  }
  .empty strong {
    font-size: 13px;
  }
  .empty p {
    font-size: 12px;
  }
  .global-search input {
    font-size: 13px;
  }
  .landscape {
    inset: -3px -24px -8px 32%;
    opacity: 0.7;
  }
  .list-row .title,
  .timeline-row .title {
    font-size: 12px;
  }
  .list-row .subtitle,
  .timeline-row .subtitle {
    font-size: 11px;
  }
}

.table-scroll:has(.page-table) + .empty {
  min-height: 240px;
}
.overview-top .table-scroll + .empty {
  min-height: 148px;
}
.overview-top > .panel {
  min-height: 0;
}
.overview-top .panel-content {
  padding-bottom: 8px;
}
.overview-top .panel-foot {
  min-height: 48px;
}
.overview-top > .panel:first-child .panel-content {
  min-height: 175px;
}
@media (max-width: 640px) {
  .table-scroll + .empty {
    max-width: 100%;
  }
  .empty p {
    max-width: 100%;
  }
  .overview-top .panel-foot {
    flex-wrap: wrap;
    gap: 5px;
  }
  .overview-top > .panel:first-child .panel-content {
    min-height: 120px;
  }
  .overview-top .table-scroll + .empty {
    min-height: 150px;
  }
}

/* Overview uses the reference's headerless project rows and compact creation bar. */
.compact-projects thead {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.compact-projects td {
  height: 52px;
  padding-top: 7px;
  padding-bottom: 7px;
}
.overview-top > .panel:first-child .panel-foot {
  min-height: 38px;
  padding: 6px 12px;
}
.overview-top > .panel:first-child .panel-content {
  padding-bottom: 6px;
}
.overview-top > .panel:first-child .panel-head {
  border-bottom: 1px solid var(--line-soft);
  margin: 0 12px;
  padding: 0 6px;
}
.overview-top .compact-projects .project-cell .title {
  font-size: 12px;
}
.overview-top .compact-projects .project-cell .subtitle {
  font-size: 11px;
}

.devices-body {
  margin-top: 16px;
}
.dialog-open {
  overflow: hidden;
}
.panel-foot .icon {
  width: 13px;
  height: 13px;
}
`;
