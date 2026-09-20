const SENSITIVE_KEY =
  /(?:authorization|cookie|password|passwd|secret|token|api[_-]?key|private[_-]?key|client[_-]?secret)/i;

const TEXT_RULES: readonly { id: string; expression: RegExp }[] = [
  {
    id: 'private-key',
    expression:
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  },
  { id: 'bearer', expression: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi },
  { id: 'openai-key', expression: /\bsk-[A-Za-z0-9_-]{16,}/g },
  {
    id: 'github-token',
    expression: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
  },
  { id: 'aws-access-key', expression: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  {
    id: 'aws-secret-key',
    expression: /\bAWS_SECRET_ACCESS_KEY\b\s*[:=]\s*(["']?)[^\s,"';]+\1/gi,
  },
  { id: 'jwt', expression: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  {
    id: 'assignment',
    expression:
      /\b(password|passwd|secret|token|api[_-]?key|client[_-]?secret)\b\s*[:=]\s*(["']?)[^\s,"';]+\2/gi,
  },
  { id: 'url-userinfo', expression: /:\/\/[^\s/@:]+:[^\s/@]+@/g },
];

export type RedactionResult<T> = {
  value: T;
  rules: string[];
  count: number;
};

export class Redactor {
  readonly #exactSecrets: string[];

  constructor(exactSecrets: Iterable<string> = []) {
    this.#exactSecrets = [...exactSecrets].filter((secret) => secret.length >= 5);
  }

  redactText(input: string): RedactionResult<string> {
    let value = input;
    const rules = new Set<string>();
    let count = 0;

    for (const secret of this.#exactSecrets) {
      if (!value.includes(secret)) continue;
      value = value.split(secret).join('[REDACTED]');
      rules.add('registered-secret');
      count += 1;
    }

    for (const rule of TEXT_RULES) {
      rule.expression.lastIndex = 0;
      value = value.replace(rule.expression, (match) => {
        if (rule.id === 'assignment') {
          const separatorIndex = Math.max(match.indexOf('='), match.indexOf(':'));
          const assignedValue = match
            .slice(separatorIndex + 1)
            .trim()
            .replace(/^["']|["']$/g, '');
          if (/^(?:read|write|none|true|false|null)$/i.test(assignedValue)) return match;
          rules.add(rule.id);
          count += 1;
          return `${match.slice(0, separatorIndex + 1)}[REDACTED]`;
        }
        rules.add(rule.id);
        count += 1;
        if (rule.id === 'url-userinfo') return '://[REDACTED]@';
        return '[REDACTED]';
      });
    }

    return { value, rules: [...rules], count };
  }

  redact<T>(input: T): RedactionResult<T> {
    const rules = new Set<string>();
    let count = 0;
    const seen = new WeakSet();

    const visit = (value: unknown, key?: string): unknown => {
      if (key && SENSITIVE_KEY.test(key)) {
        rules.add('sensitive-key');
        count += 1;
        return '[REDACTED]';
      }
      if (typeof value === 'string') {
        const redacted = this.redactText(value);
        redacted.rules.forEach((rule) => rules.add(rule));
        count += redacted.count;
        return redacted.value;
      }
      if (value === null || typeof value !== 'object') return value;
      if (seen.has(value)) return '[CIRCULAR]';
      seen.add(value);
      try {
        if (Array.isArray(value)) return value.map((item) => visit(item));
        return Object.fromEntries(
          Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
            entryKey,
            visit(entryValue, entryKey),
          ]),
        );
      } finally {
        // Shared references are valid JSON data; only ancestors indicate a cycle.
        seen.delete(value);
      }
    };

    return { value: visit(input) as T, rules: [...rules], count };
  }
}
