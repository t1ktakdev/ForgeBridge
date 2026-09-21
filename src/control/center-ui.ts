import { controlStyles } from './center/styles.js';
import { i18nSource } from './center/i18n.js';
import { primitivesSource } from './center/primitives.js';
import { viewsSource } from './center/views.js';
import { settingsSource } from './center/settings.js';
import { dialogsSource } from './center/dialogs.js';
import { runtimeSource } from './center/runtime.js';

function escapeAttribute(value: string): string {
  const entities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return value.replace(/[&<>"']/g, (character) => entities[character] ?? character);
}

/** Self-contained, dependency-free frontend for the existing local Control API. */
export function renderControlCenterUi(nonce: string, csrfToken: string): string {
  const safeNonce = escapeAttribute(nonce);
  const serializedCsrf = JSON.stringify(csrfToken).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>ForgeBridge Control Center</title><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 40 40%27%3E%3Cpath fill=%27%23f2c16e%27 d=%27m3 32 16-24 8 2 10 23h-8l-7-18-12 17z%27/%3E%3C/svg%3E"><style nonce="${safeNonce}">${controlStyles}</style></head>
<body>
<div id="app">
<aside class="sidebar" id="sidebar"><a class="brand" href="#/overview" aria-label="ForgeBridge"><svg class="brand-logo" viewBox="0 0 52 46" aria-hidden="true"><path fill="#f2c16e" d="m3 36 15-17 11-4-7-6 5-5 8 1 8 12 7 21h-8l-6-20-6-10 2 10 8 20h-6l-8-16-9 5-10 10H3z"/><path fill="#ffe4b1" d="m24 8 5-4-3 9-8 5 6-10z"/></svg><div><div class="brand-title">ForgeBridge</div><div id="brand-subtitle" class="brand-subtitle">Control Center</div></div></a><nav class="nav" id="navigation" aria-label="Main"></nav><div class="sidebar-foot"><button class="connection-button" id="connection-button" data-action="device-details"></button><div class="connection-version" id="connection-version"></div></div></aside>
<div class="sidebar-scrim"></div>
<main class="main"><header class="topbar"><button id="mobile-menu" class="icon-button mobile-menu" data-action="mobile-menu" aria-label="Open navigation"><svg class="icon" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button><div class="global-search"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input id="global-search" type="search" autocomplete="off" spellcheck="false"><kbd>⌘ K</kbd></div><div class="top-actions"><div id="language-switch" class="language-switch"></div><button id="theme-toggle" class="icon-button" data-action="theme-toggle"></button><button id="notification-button" class="icon-button" data-action="notifications-toggle" aria-expanded="false"></button><button id="profile-button" class="profile-button" data-action="profile-toggle" aria-expanded="false"></button></div><div id="popover-host"></div></header><div id="page" class="content" aria-live="polite"></div></main>
</div>
<div id="dialog-overlay" class="overlay" inert></div><div id="connect-overlay" class="overlay connect-overlay" inert></div><div id="toast-stack" class="toast-stack" role="status" aria-live="polite"></div>
<script nonce="${safeNonce}">(()=>{'use strict';let csrfToken=${serializedCsrf};
${i18nSource}
${primitivesSource}
${runtimeSource}
${viewsSource}
${settingsSource}
${dialogsSource}
start();
})();</script></body></html>`;
}
