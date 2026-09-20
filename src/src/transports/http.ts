import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server as NodeHttpServer,
  type ServerResponse,
} from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { ForgeBridgeAgent } from '../agent.js';
import { renderControlUi } from '../control/ui.js';
import { asForgeBridgeError, ForgeBridgeError } from '../core/errors.js';
import type { LocalTokenStore } from '../core/local-token.js';
import { createForgeBridgeMcpServer } from '../mcp/server.js';

const ControlActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('pause') }).strict(),
  z.object({ action: z.literal('resume') }).strict(),
  z.object({ action: z.literal('revoke') }).strict(),
  z
    .object({
      action: z.literal('set_execution_profile'),
      profile: z.enum(['normal', 'background', 'gaming']),
    })
    .strict(),
  z.object({ action: z.literal('set_background_mode'), enabled: z.boolean() }).strict(),
  z
    .object({
      action: z.literal('foreground_action'),
      foregroundActionId: z.uuid(),
      response: z.enum(['approve', 'defer', 'cancel']),
    })
    .strict(),
  z.object({ action: z.literal('set_mode'), mode: z.enum(['ask', 'balanced', 'full']) }).strict(),
  z
    .object({
      action: z.literal('set_project_mode'),
      root: z.string().min(1).max(32_768),
      mode: z.enum(['ask', 'balanced', 'full']),
    })
    .strict(),
  z
    .object({
      action: z.literal('set_project_policy'),
      root: z.string().min(1).max(32_768),
      mode: z.enum(['ask', 'balanced', 'full']),
      autonomy: z.enum(['standard', 'trusted-local']),
    })
    .strict(),
  z
    .object({ action: z.literal('remove_project_profile'), root: z.string().min(1).max(32_768) })
    .strict(),
  z.object({ action: z.literal('revoke_grant'), grantId: z.uuid() }).strict(),
  z
    .object({
      action: z.literal('approval'),
      approvalId: z.uuid(),
      response: z.enum(['deny', 'once', 'session', 'temporary']),
      durationMs: z
        .number()
        .int()
        .min(10_000)
        .max(60 * 60_000)
        .optional(),
      maxUses: z.number().int().min(1).max(10_000).optional(),
    })
    .strict(),
]);

type Session = { transport: StreamableHTTPServerTransport; server: McpServer };

export type LocalHttpAddress = { host: string; port: number; mcpUrl: string; uiUrl: string };

export class LocalHttpTransportServer {
  readonly #agent: ForgeBridgeAgent;
  readonly #tokens: LocalTokenStore;
  readonly #host: '127.0.0.1' | '::1';
  readonly #configuredPort: number;
  readonly #allowedOrigins: ReadonlySet<string>;
  readonly #maxRequestBytes: number;
  readonly #maxConcurrentRequests: number;
  readonly #saveConfiguration?: () => Promise<void>;
  readonly #sessions = new Map<string, Session>();
  #server?: NodeHttpServer;
  #activeRequests = 0;
  #address?: LocalHttpAddress;
  #csrfToken = randomBytes(32).toString('base64url');

  constructor(options: {
    agent: ForgeBridgeAgent;
    tokens: LocalTokenStore;
    host: '127.0.0.1' | '::1';
    port: number;
    allowedOrigins: readonly string[];
    maxRequestBytes: number;
    maxConcurrentRequests: number;
    saveConfiguration?: () => Promise<void>;
  }) {
    this.#agent = options.agent;
    this.#tokens = options.tokens;
    this.#host = options.host;
    this.#configuredPort = options.port;
    this.#allowedOrigins = new Set(options.allowedOrigins);
    this.#maxRequestBytes = options.maxRequestBytes;
    this.#maxConcurrentRequests = options.maxConcurrentRequests;
    this.#saveConfiguration = options.saveConfiguration;
  }

  get address(): LocalHttpAddress | undefined {
    return this.#address;
  }

  async listen(): Promise<LocalHttpAddress> {
    if (this.#server)
      throw new ForgeBridgeError('already_running', 'HTTP transport is already running');
    await this.#tokens.loadOrCreate();
    const server = createServer((request, response) => {
      void this.handle(request, response).catch((error: unknown) => {
        if (!response.headersSent) this.jsonError(response, error, 500);
        else response.destroy();
      });
    });
    server.requestTimeout = 65_000;
    server.headersTimeout = 10_000;
    server.keepAliveTimeout = 20_000;
    server.maxRequestsPerSocket = 1000;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(this.#configuredPort, this.#host, () => {
          server.off('error', reject);
          resolve();
        });
      });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      throw new ForgeBridgeError(
        'http_listen_failed',
        `Could not bind the loopback HTTP transport on ${this.#host}:${this.#configuredPort}`,
        { ...(code ? { causeCode: code } : {}) },
        code === 'EADDRINUSE',
      );
    }
    const raw = server.address();
    if (!raw || typeof raw === 'string') throw new Error('HTTP server did not expose an address');
    const hostForUrl = this.#host === '::1' ? '[::1]' : this.#host;
    this.#address = {
      host: this.#host,
      port: raw.port,
      mcpUrl: `http://${hostForUrl}:${raw.port}/mcp`,
      uiUrl: `http://${hostForUrl}:${raw.port}/ui`,
    };
    this.#server = server;
    return this.#address;
  }

  async close(): Promise<void> {
    const sessions = [...this.#sessions.values()];
    this.#sessions.clear();
    await Promise.allSettled(sessions.map(async ({ server }) => server.close()));
    const server = this.#server;
    this.#server = undefined;
    this.#address = undefined;
    if (!server) return;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    if (!this.validHost(request)) {
      this.json(response, 403, {
        ok: false,
        error: { code: 'forbidden_host', message: 'Host is not allowed' },
      });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      this.json(response, 200, { ok: true, status: this.#agent.paused ? 'paused' : 'ready' });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/ui') {
      const nonce = randomBytes(18).toString('base64url');
      response.statusCode = 200;
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.setHeader('X-Frame-Options', 'DENY');
      response.setHeader(
        'Content-Security-Policy',
        `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      );
      response.end(renderControlUi(nonce, this.#csrfToken));
      return;
    }

    if (!this.validOrigin(request)) {
      this.json(response, 403, {
        ok: false,
        error: { code: 'forbidden_origin', message: 'Host or Origin is not allowed' },
      });
      return;
    }
    if (!(await this.authenticated(request))) {
      response.setHeader('WWW-Authenticate', 'Bearer realm="ForgeBridge local"');
      this.json(response, 401, {
        ok: false,
        error: { code: 'unauthorized', message: 'A valid local bearer token is required' },
      });
      return;
    }
    if (this.#activeRequests >= this.#maxConcurrentRequests) {
      response.setHeader('Retry-After', '1');
      this.json(response, 429, {
        ok: false,
        error: { code: 'busy', message: 'Too many concurrent requests' },
      });
      return;
    }

    this.#activeRequests += 1;
    try {
      if (url.pathname === '/mcp') {
        await this.handleMcp(request, response);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/control/status') {
        this.json(response, 200, { ok: true, status: this.#agent.status() });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/control/audit') {
        const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') ?? 100), 500));
        const after = Math.max(0, Number(url.searchParams.get('after') ?? 0));
        this.json(response, 200, { ok: true, audit: await this.#agent.audit.list(after, limit) });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/control/csrf') {
        this.json(response, 200, { ok: true, csrfToken: this.#csrfToken });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/control/action') {
        if (!this.validCsrf(request)) {
          this.json(response, 403, {
            ok: false,
            error: { code: 'invalid_csrf', message: 'A valid per-start CSRF token is required' },
          });
          return;
        }
        await this.handleControlAction(request, response);
        return;
      }
      this.json(response, 404, {
        ok: false,
        error: { code: 'not_found', message: 'Route not found' },
      });
    } finally {
      this.#activeRequests -= 1;
    }
  }

  private async handleMcp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const sessionHeader = request.headers['mcp-session-id'];
    const sessionId = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;
    let parsedBody: unknown;
    if (request.method === 'POST') parsedBody = await this.readJson(request);
    let session = sessionId ? this.#sessions.get(sessionId) : undefined;

    if (!session && request.method === 'POST' && !sessionId && isInitializeRequest(parsedBody)) {
      const server = createForgeBridgeMcpServer(this.#agent, {
        actorId: 'authenticated-loopback-client',
      });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID,
        enableJsonResponse: true,
        allowedHosts: this.allowedHosts(),
        allowedOrigins: [...this.#allowedOrigins],
        enableDnsRebindingProtection: true,
        onsessioninitialized: (createdSessionId) => {
          this.#sessions.set(createdSessionId, { transport, server });
        },
        onsessionclosed: (closedSessionId) => {
          this.#agent.permissions.clearSession(closedSessionId);
          this.#sessions.delete(closedSessionId);
        },
      });
      await server.connect(transport);
      transport.onclose = () => {
        const closedSessionId = transport.sessionId;
        if (closedSessionId) {
          this.#agent.permissions.clearSession(closedSessionId);
          this.#sessions.delete(closedSessionId);
        }
      };
      session = { transport, server };
    }

    if (!session) {
      this.json(response, sessionId ? 404 : 400, {
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Missing or invalid MCP session' },
        id: null,
      });
      return;
    }
    await session.transport.handleRequest(request, response, parsedBody);
  }

  private async handleControlAction(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const action = ControlActionSchema.parse(await this.readJson(request));
    const correlationId = randomUUID();
    const started = Date.now();
    const capability =
      action.action === 'revoke'
        ? ('agent.revoke' as const)
        : action.action === 'approval' ||
            action.action === 'revoke_grant' ||
            action.action === 'foreground_action'
          ? ('approvals.respond' as const)
          : ('agent.configure' as const);
    const auditBase = {
      correlationId,
      actorId: 'local-control-user',
      sessionId: 'local-control',
      tool: 'local_control',
      operation: action.action,
      capability,
      scope: { kind: 'device' as const, value: this.#agent.identity.deviceId },
      arguments: action,
      decision: 'allow' as const,
      ruleId: 'local-control',
    };
    await this.#agent.audit.append({ ...auditBase, result: 'allowed' });
    try {
      if (action.action === 'pause') this.#agent.pause();
      else if (action.action === 'resume') this.#agent.resume();
      else if (action.action === 'set_execution_profile') {
        await this.#agent.setExecutionProfile(action.profile);
        await this.#saveConfiguration?.();
      } else if (action.action === 'set_background_mode') {
        await this.#agent.setBackgroundMode(action.enabled);
        await this.#saveConfiguration?.();
      } else if (action.action === 'foreground_action') {
        await this.#agent.respondForegroundAction(action.foregroundActionId, action.response);
      } else if (action.action === 'set_mode') {
        this.#agent.setMode(action.mode);
        await this.#saveConfiguration?.();
      } else if (action.action === 'set_project_mode') {
        await this.#agent.setProjectMode(action.root, action.mode);
        await this.#saveConfiguration?.();
      } else if (action.action === 'set_project_policy') {
        await this.#agent.setProjectPolicy(action.root, action.mode, action.autonomy);
        await this.#saveConfiguration?.();
      } else if (action.action === 'remove_project_profile') {
        await this.#agent.removeProjectProfile(action.root);
        await this.#saveConfiguration?.();
      } else if (action.action === 'revoke_grant') {
        await this.#agent.permissions.revokeGrant(action.grantId);
      } else if (action.action === 'approval') {
        await this.#agent.approvals.respond(
          action.approvalId,
          action.response,
          action.durationMs,
          action.maxUses,
        );
      } else {
        await this.#agent.revoke();
      }
      await this.#agent.audit.append({
        ...auditBase,
        result: 'succeeded',
        durationMs: Date.now() - started,
      });
    } catch (error) {
      const normalized = asForgeBridgeError(error);
      await this.#agent.audit.append({
        ...auditBase,
        result: 'failed',
        durationMs: Date.now() - started,
        errorCode: normalized.code,
      });
      throw error;
    }

    if (action.action === 'revoke') {
      await this.#tokens.rotate();
      this.#csrfToken = randomBytes(32).toString('base64url');
      const sessions = [...this.#sessions.values()];
      this.#sessions.clear();
      await Promise.allSettled(sessions.map(async ({ server }) => server.close()));
    }
    this.json(response, 200, { ok: true, status: this.#agent.status() });
  }

  private async readJson(request: IncomingMessage): Promise<unknown> {
    const declared = Number(request.headers['content-length'] ?? 0);
    if (Number.isFinite(declared) && declared > this.#maxRequestBytes) {
      request.resume();
      throw new ForgeBridgeError('request_too_large', 'Request body exceeds the configured limit');
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of request) {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      bytes += value.length;
      if (bytes > this.#maxRequestBytes) {
        throw new ForgeBridgeError(
          'request_too_large',
          'Request body exceeds the configured limit',
        );
      }
      chunks.push(value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch {
      throw new ForgeBridgeError('invalid_json', 'Request body is not valid JSON');
    }
  }

  private validHost(request: IncomingMessage): boolean {
    const host = request.headers.host?.toLocaleLowerCase('en-US');
    return host !== undefined && this.allowedHosts().includes(host);
  }

  private validOrigin(request: IncomingMessage): boolean {
    const origin = request.headers.origin;
    if (!origin) return true;
    if (Array.isArray(origin)) return false;
    if (this.#allowedOrigins.has(origin)) return true;
    if (!this.#address) return false;
    try {
      const parsed = new URL(origin);
      return (
        parsed.protocol === 'http:' &&
        Number(parsed.port) === this.#address.port &&
        (parsed.hostname === '127.0.0.1' ||
          parsed.hostname === 'localhost' ||
          parsed.hostname === '[::1]')
      );
    } catch {
      return false;
    }
  }

  private validCsrf(request: IncomingMessage): boolean {
    const value = request.headers['x-forgebridge-csrf'];
    if (typeof value !== 'string') return false;
    const supplied = Buffer.from(value, 'utf8');
    const expected = Buffer.from(this.#csrfToken, 'utf8');
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }

  private allowedHosts(): string[] {
    const port = this.#address?.port ?? this.#configuredPort;
    return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
  }

  private async authenticated(request: IncomingMessage): Promise<boolean> {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) return false;
    return this.#tokens.verify(authorization.slice('Bearer '.length));
  }

  private json(response: ServerResponse, status: number, value: unknown): void {
    response.statusCode = status;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(JSON.stringify(value));
  }

  private jsonError(response: ServerResponse, error: unknown, fallbackStatus: number): void {
    const normalized =
      error instanceof z.ZodError
        ? new ForgeBridgeError('invalid_request', 'Request does not match the required schema')
        : asForgeBridgeError(error);
    const status =
      normalized.code === 'request_too_large'
        ? 413
        : normalized.code === 'invalid_json' || normalized.code === 'invalid_request'
          ? 400
          : fallbackStatus;
    const safe = this.#agent.redactor.redact({
      ok: false,
      error: { code: normalized.code, message: normalized.message },
    }).value;
    this.json(response, status, safe);
  }
}
