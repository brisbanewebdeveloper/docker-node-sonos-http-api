import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { startMcpTextServer } from '../lib/mcp-server.js';

async function withServer(handler, run) {
  const server = http.createServer(handler);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  try {
    await run({
      url: `http://127.0.0.1:${port}`
    });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
}

async function withClient(options, run) {
  const startedServer = await startMcpTextServer({ port: 0, ...options });
  const client = new Client({ name: 'mcp-text-server-test-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(startedServer.url));

  try {
    await client.connect(transport);
    await run(client);
    await transport.terminateSession();
    await client.close();
  } finally {
    await startedServer.close();
  }
}

test('MCP server exposes the text-processing tool', async () => {
  await withClient({}, async (client) => {
    const response = await client.listTools({});

    assert.deepEqual(
      response.tools.map((tool) => tool.name).sort(),
      ['list-sonos-rooms', 'play-sonos-clip', 'process-chat-text', 'speak-on-sonos']
    );
  });
});

test('MCP server lists flattened Sonos room details', async () => {
  await withServer((req, res) => {
    assert.equal(req.url, '/zones');
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify([
      {
        uuid: 'zone-1',
        coordinator: {
          uuid: 'room-office',
          state: 'PLAYING',
          playMode: 'NORMAL',
          roomName: 'Office',
          coordinator: 'room-office',
          groupState: 'PLAYING'
        },
        members: [
          {
            uuid: 'room-kitchen',
            state: 'PLAYING',
            playMode: 'NORMAL',
            roomName: 'Kitchen',
            coordinator: 'room-office',
            groupState: 'PLAYING'
          }
        ]
      }
    ]));
  }, async ({ url }) => {
    await withClient({ sonosApiBaseUrl: url }, async (client) => {
      const result = await client.callTool({
        name: 'list-sonos-rooms',
        arguments: {}
      });

      assert.notEqual(result.isError, true);
      assert.deepEqual(result.content, [{ type: 'text', text: 'Found 2 Sonos rooms.' }]);
      assert.deepEqual(result.structuredContent, {
        action: 'list-sonos-rooms',
        requestPath: '/zones',
        statusCode: 200,
        rooms: [
          {
            uuid: 'room-kitchen',
            roomName: 'Kitchen',
            state: 'PLAYING',
            playMode: 'NORMAL',
            groupState: 'PLAYING',
            coordinatorUuid: 'room-office',
            zoneUuid: 'zone-1',
            isCoordinator: false
          },
          {
            uuid: 'room-office',
            roomName: 'Office',
            state: 'PLAYING',
            playMode: 'NORMAL',
            groupState: 'PLAYING',
            coordinatorUuid: 'room-office',
            zoneUuid: 'zone-1',
            isCoordinator: true
          }
        ]
      });
    });
  });
});

test('MCP server normalizes valid chat text', async () => {
  await withClient({}, async (client) => {
    const result = await client.callTool({
      name: 'process-chat-text',
      arguments: {
        text: '  hello   team\r\n\r\nmessage   '
      }
    });

    assert.notEqual(result.isError, true);
    assert.deepEqual(result.content, [{ type: 'text', text: 'hello team\n\nmessage' }]);
    assert.deepEqual(result.structuredContent, {
      originalLength: 28,
      normalizedLength: 19,
      normalizedText: 'hello team\n\nmessage',
      changed: true
    });
  });
});

test('MCP server rejects structured payload text', async () => {
  await withClient({}, async (client) => {
    const result = await client.callTool({
      name: 'process-chat-text',
      arguments: {
        text: '{"messages":[{"role":"user","content":"hello"}]}'
      }
    });

    assert.equal(result.isError, true);
    assert.equal(result.content[0].type, 'text');
    assert.match(result.content[0].text, /simple plain text/);
  });
});

test('MCP server surfaces room discovery errors from the Sonos API', async () => {
  await withServer((req, res) => {
    assert.equal(req.url, '/zones');
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'No system discovered' }));
  }, async ({ url }) => {
    await withClient({ sonosApiBaseUrl: url }, async (client) => {
      const result = await client.callTool({
        name: 'list-sonos-rooms',
        arguments: {}
      });

      assert.equal(result.isError, true);
      assert.equal(result.content[0].type, 'text');
      assert.match(result.content[0].text, /No system discovered/);
    });
  });
});

test('MCP server delegates room speech requests to the Sonos API', async () => {
  await withServer((req, res) => {
    assert.equal(req.url, '/Office/say/hello%20team/en-gb/55');
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ status: 'success' }));
  }, async ({ url }) => {
    await withClient({ sonosApiBaseUrl: url }, async (client) => {
      const result = await client.callTool({
        name: 'speak-on-sonos',
        arguments: {
          targetType: 'room',
          target: 'Office',
          text: '  hello   team  ',
          language: 'en-gb',
          volume: 55
        }
      });

      assert.notEqual(result.isError, true);
      assert.deepEqual(result.content, [{ type: 'text', text: 'Delegated speech to room "Office".' }]);
      assert.deepEqual(result.structuredContent, {
        action: 'speak-on-sonos',
        targetType: 'room',
        target: 'Office',
        normalizedText: 'hello team',
        changed: true,
        language: 'en-gb',
        volume: 55,
        requestPath: '/Office/say/hello%20team/en-gb/55',
        statusCode: 200,
        sonosResponse: { status: 'success' }
      });
    });
  });
});

test('MCP server rejects preset speech volume overrides', async () => {
  await withClient({}, async (client) => {
    const result = await client.callTool({
      name: 'speak-on-sonos',
      arguments: {
        targetType: 'preset',
        target: 'Dinner',
        text: 'Dinner is ready',
        volume: 50
      }
    });

    assert.equal(result.isError, true);
    assert.equal(result.content[0].type, 'text');
    assert.match(result.content[0].text, /Preset speech does not support a custom volume/);
  });
});

test('MCP server surfaces missing room errors from the Sonos API', async () => {
  await withServer((req, res) => {
    assert.equal(req.url, '/Office/say/Dinner%20is%20ready');
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ status: 'error', error: "Player 'Office' not found." }));
  }, async ({ url }) => {
    await withClient({ sonosApiBaseUrl: url }, async (client) => {
      const result = await client.callTool({
        name: 'speak-on-sonos',
        arguments: {
          targetType: 'room',
          target: 'Office',
          text: 'Dinner is ready'
        }
      });

      assert.equal(result.isError, true);
      assert.equal(result.content[0].type, 'text');
      assert.match(result.content[0].text, /Player 'Office' not found/);
    });
  });
});

test('MCP server rejects unsafe clip names', async () => {
  await withClient({}, async (client) => {
    const result = await client.callTool({
      name: 'play-sonos-clip',
      arguments: {
        targetType: 'room',
        target: 'Office',
        clipName: '../secret.mp3'
      }
    });

    assert.equal(result.isError, true);
    assert.equal(result.content[0].type, 'text');
    assert.match(result.content[0].text, /simple filename/);
  });
});
