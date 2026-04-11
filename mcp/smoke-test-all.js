import {
  readCommonTargetConfiguration,
  unwrapToolResult,
  withMcpClient
} from './smoke-test-utils.js';

function readConfiguration() {
  const common = readCommonTargetConfiguration();
  const text = process.env.SMOKE_TEXT?.trim();
  const clipName = process.env.SMOKE_CLIP_NAME?.trim();

  if (!text) {
    throw new Error('SMOKE_TEXT is required so live playback is always explicit.');
  }

  if (!clipName) {
    throw new Error('SMOKE_CLIP_NAME is required so clip playback is always explicit.');
  }

  return {
    ...common,
    text,
    clipName,
    language: process.env.SMOKE_LANGUAGE?.trim() || undefined
  };
}

async function main() {
  const config = readConfiguration();

  await withMcpClient(config.mcpServerUrl, async (client) => {
    const speechResult = await client.callTool({
      name: 'speak-on-sonos',
      arguments: {
        targetType: config.targetType,
        target: config.target,
        text: config.text,
        language: config.language,
        volume: config.volume
      }
    });

    unwrapToolResult(speechResult, 'MCP combined smoke test speech step succeeded.');

    const clipResult = await client.callTool({
      name: 'play-sonos-clip',
      arguments: {
        targetType: config.targetType,
        target: config.target,
        clipName: config.clipName,
        volume: config.volume
      }
    });

    unwrapToolResult(clipResult, 'MCP combined smoke test clip step succeeded.');
  });
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
