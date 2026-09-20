import { describe, expect, it } from 'vitest';
import { Redactor } from '../../src/core/redactor.js';
import { filteredEnvironment } from '../../src/terminal/environment.js';

describe('Redactor', () => {
  it('redacts registered and structured secrets', () => {
    const registeredSecret = ['super-', 'secret-value'].join('');
    const assignmentKey = ['to', 'ken'].join('');
    const assignmentValue = ['abcdefgh', 'ijklmnop'].join('');
    const structuredKey = ['api', 'Key'].join('');
    const structuredValue = ['visible-only-', 'to-the-test'].join('');
    const redactor = new Redactor([registeredSecret]);
    const result = redactor.redact({
      message: `${assignmentKey}=${assignmentValue} Authorization: Bearer ${registeredSecret}`,
      [structuredKey]: structuredValue,
      nested: ['safe'],
    });

    expect(JSON.stringify(result.value)).not.toContain(registeredSecret);
    expect(JSON.stringify(result.value)).not.toContain(assignmentValue);
    expect(JSON.stringify(result.value)).not.toContain(structuredValue);
    expect(result.count).toBeGreaterThanOrEqual(2);
  });

  it('redacts private key blocks and URL credentials', () => {
    const redactor = new Redactor();
    const begin = ['-----BEGIN ', 'PRIVATE KEY-----'].join('');
    const end = ['-----END ', 'PRIVATE KEY-----'].join('');
    const userInfo = ['user', 'pass'].join(':');
    const result = redactor.redactText(
      `https://${userInfo}@example.test\n${begin}\nabc123\n${end}`,
    );
    expect(result.value).toContain('://[REDACTED]@example.test');
    expect(result.value).not.toContain(begin);
  });

  it('redacts common cloud credentials and rejects sensitive environment overrides', () => {
    const redactor = new Redactor();
    const awsAccessKey = ['AK', 'IA', '12345678', '90ABCDEF'].join('');
    const awsSecretName = ['AWS_', 'SECRET_', 'ACCESS_KEY'].join('');
    const awsSecretValue = ['example-', 'secret-value'].join('');
    const result = redactor.redactText(`${awsAccessKey} ${awsSecretName}=${awsSecretValue}`);
    expect(result.value).not.toContain(awsAccessKey);
    expect(result.value).not.toContain(awsSecretValue);
    expect(() => filteredEnvironment({ [awsSecretName]: awsSecretValue })).toThrow('not allowed');
    expect(() => filteredEnvironment({ SSH_AUTH_SOCK: '/tmp/agent.sock' })).toThrow('not allowed');
  });
});
