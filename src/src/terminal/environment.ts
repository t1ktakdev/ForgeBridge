import { ForgeBridgeError } from '../core/errors.js';

const SENSITIVE_ENVIRONMENT_KEY =
  /^(?:.*_)?(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|CLIENT_SECRET|ACCESS_KEY(?:_ID)?|CREDENTIALS?|CONNECTION_STRING|DATABASE_URL|COOKIE|AUTHORIZATION|SSH_AUTH_SOCK|GPG_AGENT_INFO)$/iu;

export function filteredEnvironment(
  overrides: Record<string, string> = {},
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !SENSITIVE_ENVIRONMENT_KEY.test(key)) environment[key] = value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (SENSITIVE_ENVIRONMENT_KEY.test(key)) {
      throw new ForgeBridgeError(
        'sensitive_environment',
        `Environment variable ${key} is not allowed`,
      );
    }
    environment[key] = value;
  }
  environment['TERM'] = 'xterm-256color';
  return environment;
}
