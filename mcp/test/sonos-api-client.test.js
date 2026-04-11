import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  buildClipRequestPath,
  buildSpeechRequestPath,
  createSonosApiClient,
  SonosApiError,
  validateClipName
} from '../lib/sonos-api-client.js';

async function withServer(handler, run) {
  const server = http.createServer(handler);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  try {
    await run(`http://127.0.0.1:${port}`);
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

test('buildSpeechRequestPath encodes all-room speech routes', () => {
  assert.equal(
    buildSpeechRequestPath({ targetType: 'all', text: 'Hello team', language: 'en-gb', volume: 42 }),
    '/sayall/Hello%20team/en-gb/42'
  );
});

test('buildSpeechRequestPath uses the preset route without volume', () => {
  assert.equal(
    buildSpeechRequestPath({ targetType: 'preset', target: 'Dinner Bell', text: 'Food is ready', language: 'Nicole' }),
    '/saypreset/Dinner%20Bell/Food%20is%20ready/Nicole'
  );
});

test('buildClipRequestPath uses the preset clip route without volume', () => {
  assert.equal(
    buildClipRequestPath({ targetType: 'preset', target: 'Alarm', clipName: 'doorbell.mp3' }),
    '/clippreset/Alarm/doorbell.mp3'
  );
});

test('validateClipName rejects path traversal', () => {
  assert.throws(() => validateClipName('../secret.mp3'), SonosApiError);
});

test('createSonosApiClient requests Sonos zones for room discovery', async () => {
  await withServer((req, res) => {
    assert.equal(req.url, '/zones');
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify([
      {
        uuid: 'zone-1',
        coordinator: {
          uuid: 'room-office',
          roomName: 'Office'
        },
        members: []
      }
    ]));
  }, async (baseUrl) => {
    const client = createSonosApiClient({ baseUrl, timeoutMs: 1000 });
    const result = await client.listRooms();

    assert.deepEqual(result, {
      requestPath: '/zones',
      statusCode: 200,
      body: [
        {
          uuid: 'zone-1',
          coordinator: {
            uuid: 'room-office',
            roomName: 'Office'
          },
          members: []
        }
      ]
    });
  });
});

test('createSonosApiClient returns parsed JSON responses', async () => {
  await withServer((req, res) => {
    assert.equal(req.url, '/Office/clip/bell.mp3/70');
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ status: 'success', zone: 'Office' }));
  }, async (baseUrl) => {
    const client = createSonosApiClient({ baseUrl, timeoutMs: 1000 });
    const result = await client.playClip({
      targetType: 'room',
      target: 'Office',
      clipName: 'bell.mp3',
      volume: 70
    });

    assert.deepEqual(result, {
      requestPath: '/Office/clip/bell.mp3/70',
      statusCode: 200,
      body: { status: 'success', zone: 'Office' }
    });
  });
});

test('createSonosApiClient surfaces upstream Sonos errors', async () => {
  await withServer((req, res) => {
    assert.equal(req.url, '/sayall/Hello');
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'No system discovered' }));
  }, async (baseUrl) => {
    const client = createSonosApiClient({ baseUrl, timeoutMs: 1000 });

    await assert.rejects(
      client.speak({ targetType: 'all', text: 'Hello' }),
      /No system discovered/
    );
  });
});
