export type ErrorDetails = Record<string, unknown>;

export class ForgeBridgeError extends Error {
  readonly code: string;
  readonly details: ErrorDetails;
  readonly retryable: boolean;

  constructor(code: string, message: string, details: ErrorDetails = {}, retryable = false) {
    super(message);
    this.name = 'ForgeBridgeError';
    this.code = code;
    this.details = details;
    this.retryable = retryable;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function asForgeBridgeError(error: unknown): ForgeBridgeError {
  if (error instanceof ForgeBridgeError) return error;
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    return new ForgeBridgeError('os_error', error.message, {
      blocked_by: 'operating_system',
      os_code: error.code,
      next_action: 'inspect_os_error',
    });
  }
  if (error instanceof Error && error.name === 'ZodError') {
    return new ForgeBridgeError(
      'invalid_schema',
      'Input or persisted data failed schema validation',
      {
        blocked_by: 'forgebridge',
        next_action: 'inspect_schema',
      },
    );
  }
  return new ForgeBridgeError('internal_error', errorMessage(error));
}
