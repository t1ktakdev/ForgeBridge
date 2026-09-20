import { describe, expect, it } from 'vitest';
import { classifyCommand } from '../../src/terminal/process-utils.js';

describe('classifyCommand', () => {
  it('flags elevation, persistence, credential dumping, and destructive patterns', () => {
    expect(classifyCommand('Start-Process cmd -Verb RunAs').flags).toContain('elevation');
    expect(classifyCommand('schtasks /create /tn demo').flags).toContain('persistence');
    expect(classifyCommand('procdump.exe -ma lsass.exe dump.dmp').flags).toContain(
      'credential-dump',
    );
    expect(classifyCommand('Remove-Item -Recurse project').flags).toContain('destructive');
  });

  it('classifies package installs and Git remote/destructive mutations', () => {
    expect(classifyCommand('pnpm install').flags).toContain('package-install');
    expect(classifyCommand('git push origin main').flags).toContain('git-push');
    expect(classifyCommand('git push --force origin main').flags).toContain('git-force-push');
    expect(classifyCommand('git reset --hard HEAD~1').flags).toContain('git-destructive');
  });

  it('does not flag ordinary development commands', () => {
    expect(classifyCommand('pnpm test').flags).toEqual([]);
    expect(classifyCommand('git status --short').flags).toEqual([]);
  });
});
