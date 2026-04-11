import { startMcpTextServer } from './lib/mcp-server.js';

const host = process.env.MCP_HOST || '127.0.0.1';
const port = Number(process.env.MCP_PORT || 3101);
const path = process.env.MCP_PATH || '/mcp';
const sonosApiBaseUrl = process.env.SONOS_API_BASE_URL || 'http://127.0.0.1:5005';
const sonosApiTimeoutMs = Number(process.env.SONOS_API_TIMEOUT_MS || 10000);

startMcpTextServer({ host, port, path, sonosApiBaseUrl, sonosApiTimeoutMs })
  .then(({ url }) => {
    process.stdout.write(`MCP server listening on ${url}\n`);
  })
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
