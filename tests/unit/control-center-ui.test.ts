import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { renderControlCenterUi } from '../../src/control/center-ui.js';

describe('Control Center UI', () => {
  it('renders a nonce-bound self-contained shell and escapes inline bootstrap data', () => {
    const html = renderControlCenterUi('nonce"&<>', 'csrf</script><script>alert(1)</script>');

    expect(html).toContain('ForgeBridge Control Center');
    expect(html).toContain('nonce="nonce&quot;&amp;&lt;&gt;"');
    expect(html).toContain('\\u003c/script>');
    expect(html).not.toContain('</script><script>alert(1)</script>');
    expect(html).toContain('id="connect-overlay"');
    expect(html).toContain('sessionStorage');
  });

  it('emits syntactically valid browser JavaScript', () => {
    const html = renderControlCenterUi('safe-nonce', 'safe-csrf');
    const match = /<script nonce="safe-nonce">([\s\S]*?)<\/script>/.exec(html);

    expect(match).not.toBeNull();
    expect(() => new Script(match?.[1] ?? '')).not.toThrow();
  });

  it('ships all Control Center routes plus persistent English and Russian localization', () => {
    const html = renderControlCenterUi('safe-nonce', 'safe-csrf');

    for (const route of [
      'overview',
      'projects',
      'devices',
      'jobs',
      'sessions',
      'approvals',
      'audit',
      'settings',
    ]) {
      expect(html).toContain(route);
    }

    expect(html).toContain('forgebridge-language');
    expect(html).toContain('forgebridge-theme');
    expect(html).toContain('English');
    expect(html).toContain('Русский');
  });

  it('keeps the UI wired to the real local Control API and lifecycle actions', () => {
    const html = renderControlCenterUi('safe-nonce', 'safe-csrf');

    for (const endpoint of [
      '/control/csrf',
      '/control/status',
      '/control/audit',
      '/control/action',
    ]) {
      expect(html).toContain(endpoint);
    }

    for (const action of [
      'rename_device',
      'pause',
      'resume',
      'revoke',
      'set_mode',
      'set_execution_profile',
      'set_project_policy',
      'remove_project_profile',
      'approval',
      'revoke_grant',
      'foreground_action',
      'cancel_job',
      'kill_terminal',
      'close_browser_session',
    ]) {
      expect(html).toContain(action);
    }
  });
});
