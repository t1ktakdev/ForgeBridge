import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { ForgeBridgeAgent } from '../agent.js';
import { createForgeBridgeMcpServer } from '../mcp/server.js';

export async function connectStdio(agent: ForgeBridgeAgent) {
  const server = createForgeBridgeMcpServer(agent, {
    actorId: 'local-stdio-client',
    sessionId: 'stdio',
  });
  const transport = new StdioServerTransport();
  transport.onclose = () => agent.permissions.clearSession('stdio');
  await server.connect(transport);
  return { server, transport };
}
