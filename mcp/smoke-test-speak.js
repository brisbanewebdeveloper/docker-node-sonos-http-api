import {
  readCommonTargetConfiguration,
  unwrapToolResult,
  withMcpClient
} from './smoke-test-utils.js';

function readConfiguration() {
  const common = readCommonTargetConfiguration();

  const text = process.env.SMOKE_TEXT?.trim();

  if (!text) {
    throw new Error('SMOKE_TEXT is required so live playback is always explicit.');
  }

  return {
    ...common,
    text,
    language: process.env.SMOKE_LANGUAGE?.trim() || undefined,
  };
}

async function main() {
  const config = readConfiguration();
  await withMcpClient(config.mcpServerUrl, async (client) => {
    const result = await client.callTool({
      name: 'speak-on-sonos',
      arguments: {
        targetType: config.targetType,
        target: config.target,
        text: config.text,
        language: config.language,
        volume: config.volume
      }
    });

    unwrapToolResult(result, 'MCP speech smoke test succeeded.');
  });
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
