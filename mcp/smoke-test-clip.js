import {
  readCommonTargetConfiguration,
  unwrapToolResult,
  withMcpClient
} from './smoke-test-utils.js';

function readConfiguration() {
  const common = readCommonTargetConfiguration();
  const clipName = process.env.SMOKE_CLIP_NAME?.trim();

  if (!clipName) {
    throw new Error('SMOKE_CLIP_NAME is required so clip playback is always explicit.');
  }

  return {
    ...common,
    clipName
  };
}

async function main() {
  const config = readConfiguration();

  await withMcpClient(config.mcpServerUrl, async (client) => {
    const result = await client.callTool({
      name: 'play-sonos-clip',
      arguments: {
        targetType: config.targetType,
        target: config.target,
        clipName: config.clipName,
        volume: config.volume
      }
    });

    unwrapToolResult(result, 'MCP clip smoke test succeeded.');
  });
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
