import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

export function parseOptionalVolume(rawValue) {
  if (rawValue === undefined || rawValue === '') {
    return undefined;
  }

  const parsed = Number(rawValue);

  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
    throw new Error('SMOKE_VOLUME must be an integer from 0 to 100.');
  }

  return parsed;
}

export function readCommonTargetConfiguration() {
  const targetType = process.env.SMOKE_TARGET_TYPE || 'room';

  if (!['room', 'all', 'preset'].includes(targetType)) {
    throw new Error('SMOKE_TARGET_TYPE must be room, all, or preset.');
  }

  const target = process.env.SMOKE_TARGET?.trim();

  if ((targetType === 'room' || targetType === 'preset') && !target) {
    throw new Error('SMOKE_TARGET is required when SMOKE_TARGET_TYPE is room or preset.');
  }

  if (targetType === 'all' && target) {
    throw new Error('SMOKE_TARGET must be omitted when SMOKE_TARGET_TYPE is all.');
  }

  return {
    mcpServerUrl: process.env.MCP_SERVER_URL || 'http://127.0.0.1:3101/mcp',
    targetType,
    target,
    volume: parseOptionalVolume(process.env.SMOKE_VOLUME)
  };
}

export async function withMcpClient(mcpServerUrl, run) {
  const client = new Client({ name: 'mcp-smoke-test-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(mcpServerUrl));

  try {
    await client.connect(transport);
    return await run(client);
  } finally {
    await transport.terminateSession().catch(() => {});
    await client.close().catch(() => {});
  }
}

export function unwrapToolResult(result, successMessage) {
  if (result.isError) {
    throw new Error(result.content?.[0]?.text || 'Smoke test failed.');
  }

  process.stdout.write(`${successMessage}\n`);
  process.stdout.write(`${JSON.stringify(result.structuredContent, null, 2)}\n`);
}
