import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { McpServer, isInitializeRequest } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { ChatTextValidationError, MAX_TEXT_LENGTH, normalizeChatText } from './normalize-chat-text.js';
import {
  createSonosApiClient,
  DEFAULT_SONOS_API_BASE_URL,
  DEFAULT_SONOS_API_TIMEOUT_MS,
  SonosApiError
} from './sonos-api-client.js';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3101;
const DEFAULT_PATH = '/mcp';
const MAX_BODY_BYTES = 64 * 1024;
const SESSION_HEADER = 'mcp-session-id';
const EXPOSED_HEADERS = 'Mcp-Session-Id, Mcp-Protocol-Version';
const TARGET_TYPES = ['room', 'all', 'preset'];

function buildToolError(error, fallbackMessage) {
  const message = error instanceof ChatTextValidationError || error instanceof SonosApiError
    ? error.message
    : fallbackMessage;

  return {
    content: [
      {
        type: 'text',
        text: message
      }
    ],
    isError: true
  };
}

function requireTargetWhenNeeded(value, ctx) {
  if ((value.targetType === 'room' || value.targetType === 'preset') && !value.target) {
    ctx.addIssue({
      code: 'custom',
      path: ['target'],
      message: 'Target is required when targetType is room or preset.'
    });
  }

  if (value.targetType === 'all' && value.target) {
    ctx.addIssue({
      code: 'custom',
      path: ['target'],
      message: 'Target must be omitted when targetType is all.'
    });
  }
}

function createSpeechToolSchema() {
  return z.object({
    targetType: z.enum(TARGET_TYPES).describe('Where to speak: one room, all rooms, or a named preset.'),
    target: z.string().trim().min(1).max(120).optional().describe('Required room or preset name when targetType is not all.'),
    text: z.string().max(MAX_TEXT_LENGTH).describe('Plain chat text to speak on Sonos.'),
    language: z.string().trim().min(1).max(120).optional().describe('Optional language or voice value for the configured TTS provider.'),
    volume: z.number().int().min(0).max(100).optional().describe('Optional announce volume from 0 to 100. Not supported for preset speech.')
  }).superRefine((value, ctx) => {
    requireTargetWhenNeeded(value, ctx);

    if (value.targetType === 'preset' && value.volume !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['volume'],
        message: 'Preset speech does not support a custom volume.'
      });
    }
  });
}

function createClipToolSchema() {
  return z.object({
    targetType: z.enum(TARGET_TYPES).describe('Where to play the clip: one room, all rooms, or a named preset.'),
    target: z.string().trim().min(1).max(120).optional().describe('Required room or preset name when targetType is not all.'),
    clipName: z.string().trim().min(1).max(255).describe('Clip filename from the Sonos clips directory.'),
    volume: z.number().int().min(0).max(100).optional().describe('Optional announce volume from 0 to 100. Not supported for preset clip playback.')
  }).superRefine((value, ctx) => {
    requireTargetWhenNeeded(value, ctx);

    if (value.targetType === 'preset' && value.volume !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['volume'],
        message: 'Preset clip playback does not support a custom volume.'
      });
    }
  });
}

function describeTarget(targetType, target) {
  if (targetType === 'all') {
    return 'all Sonos players';
  }

  if (targetType === 'room') {
    return `room "${target}"`;
  }

  return `preset "${target}"`;
}

function createTextProcessingServer(options = {}) {
  const sonosClient = createSonosApiClient({
    baseUrl: options.sonosApiBaseUrl || DEFAULT_SONOS_API_BASE_URL,
    timeoutMs: options.sonosApiTimeoutMs || DEFAULT_SONOS_API_TIMEOUT_MS
  });
  const server = new McpServer(
    {
      name: 'sonos-http-api-mcp',
      version: '1.0.0'
    },
    {
      instructions: 'Use process-chat-text with a single plain UTF-8 string intended for a chat session. Use speak-on-sonos or play-sonos-clip to delegate announcements and clip playback to the Sonos HTTP API.'
    }
  );

  server.registerTool(
    'process-chat-text',
    {
      title: 'Process chat text',
      description: 'Validate and normalize plain text for chat-session use.',
      inputSchema: z.object({
        text: z.string().max(MAX_TEXT_LENGTH).describe('Plain chat text as a single UTF-8 string.')
      }),
      outputSchema: z.object({
        originalLength: z.number().int(),
        normalizedLength: z.number().int(),
        normalizedText: z.string(),
        changed: z.boolean()
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true
      }
    },
    async ({ text }) => {
      try {
        const normalized = normalizeChatText(text);
        return {
          content: [
            {
              type: 'text',
              text: normalized.normalizedText
            }
          ],
          structuredContent: normalized
        };
      } catch (error) {
        return buildToolError(error, 'Unable to process chat text.');
      }
    }
  );

  server.registerTool(
    'speak-on-sonos',
    {
      title: 'Speak on Sonos',
      description: 'Send plain text to the existing Sonos HTTP API so one room, all rooms, or a preset can speak it aloud.',
      inputSchema: createSpeechToolSchema(),
      outputSchema: z.object({
        action: z.literal('speak-on-sonos'),
        targetType: z.enum(TARGET_TYPES),
        target: z.string().nullable(),
        normalizedText: z.string(),
        changed: z.boolean(),
        language: z.string().nullable(),
        volume: z.number().int().nullable(),
        requestPath: z.string(),
        statusCode: z.number().int(),
        sonosResponse: z.unknown()
      })
    },
    async ({ targetType, target, text, language, volume }) => {
      try {
        const normalized = normalizeChatText(text);
        const result = await sonosClient.speak({
          targetType,
          target,
          text: normalized.normalizedText,
          language,
          volume
        });

        return {
          content: [
            {
              type: 'text',
              text: `Delegated speech to ${describeTarget(targetType, target)}.`
            }
          ],
          structuredContent: {
            action: 'speak-on-sonos',
            targetType,
            target: target || null,
            normalizedText: normalized.normalizedText,
            changed: normalized.changed,
            language: language || null,
            volume: volume ?? null,
            requestPath: result.requestPath,
            statusCode: result.statusCode,
            sonosResponse: result.body
          }
        };
      } catch (error) {
        return buildToolError(error, 'Unable to delegate speech to Sonos.');
      }
    }
  );

  server.registerTool(
    'play-sonos-clip',
    {
      title: 'Play Sonos clip',
      description: 'Play an existing clip file through the Sonos HTTP API in one room, all rooms, or a preset.',
      inputSchema: createClipToolSchema(),
      outputSchema: z.object({
        action: z.literal('play-sonos-clip'),
        targetType: z.enum(TARGET_TYPES),
        target: z.string().nullable(),
        clipName: z.string(),
        volume: z.number().int().nullable(),
        requestPath: z.string(),
        statusCode: z.number().int(),
        sonosResponse: z.unknown()
      })
    },
    async ({ targetType, target, clipName, volume }) => {
      try {
        const result = await sonosClient.playClip({
          targetType,
          target,
          clipName,
          volume
        });

        return {
          content: [
            {
              type: 'text',
              text: `Delegated clip playback to ${describeTarget(targetType, target)}.`
            }
          ],
          structuredContent: {
            action: 'play-sonos-clip',
            targetType,
            target: target || null,
            clipName: clipName.trim(),
            volume: volume ?? null,
            requestPath: result.requestPath,
            statusCode: result.statusCode,
            sonosResponse: result.body
          }
        };
      } catch (error) {
        return buildToolError(error, 'Unable to delegate clip playback to Sonos.');
      }
    }
  );

  return server;
}

function getSessionId(req) {
  const headerValue = req.headers[SESSION_HEADER];

  if (Array.isArray(headerValue)) {
    return headerValue[0];
  }

  return headerValue;
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Mcp-Session-Id, Mcp-Protocol-Version');
  res.setHeader('Access-Control-Expose-Headers', EXPOSED_HEADERS);
}

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(payload));
  res.end(payload);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let totalBytes = 0;
    const chunks = [];

    req.on('data', (chunk) => {
      totalBytes += chunk.length;

      if (totalBytes > MAX_BODY_BYTES) {
        reject(new Error('Request body exceeds the 64KB limit.'));
        req.destroy();
        return;
      }

      chunks.push(chunk);
    });

    req.on('end', () => {
      if (chunks.length === 0) {
        resolve(undefined);
        return;
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(new Error('Request body must be valid JSON.'));
      }
    });

    req.on('error', reject);
  });
}

function createHttpHandler(mcpServer, transports, routePath) {
  return async function handleHttpRequest(req, res) {
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    const requestUrl = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);

    if (requestUrl.pathname === '/health') {
      sendJson(res, 200, { status: 'ok' });
      return;
    }

    if (requestUrl.pathname !== routePath) {
      sendJson(res, 404, { error: 'Not found.' });
      return;
    }

    if (!['GET', 'POST', 'DELETE'].includes(req.method)) {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, POST, DELETE, OPTIONS');
      res.end();
      return;
    }

    try {
      const sessionId = getSessionId(req);
      const body = req.method === 'GET' ? undefined : await readJsonBody(req);
      const transport = sessionId ? transports.get(sessionId) : undefined;

      if (transport) {
        await transport.handleRequest(req, res, body);
        return;
      }

      if (req.method === 'POST' && !sessionId && isInitializeRequest(body)) {
        let createdTransport;
        createdTransport = new NodeStreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId) => {
            transports.set(newSessionId, createdTransport);
          }
        });

        createdTransport.onclose = () => {
          if (createdTransport.sessionId) {
            transports.delete(createdTransport.sessionId);
          }
        };

        await mcpServer.connect(createdTransport);
        await createdTransport.handleRequest(req, res, body);
        return;
      }

      sendJson(res, 400, {
        error: sessionId
          ? `No active MCP session found for ${sessionId}.`
          : 'Send an initialize request before calling MCP tools.'
      });
    } catch (error) {
      const statusCode = error.message === 'Request body exceeds the 64KB limit.' ? 413 : 400;
      sendJson(res, statusCode, { error: error.message });
    }
  };
}

export async function startMcpTextServer(options = {}) {
  const {
    host = DEFAULT_HOST,
    port = DEFAULT_PORT,
    path = DEFAULT_PATH,
    sonosApiBaseUrl = DEFAULT_SONOS_API_BASE_URL,
    sonosApiTimeoutMs = DEFAULT_SONOS_API_TIMEOUT_MS
  } = options;

  const transports = new Map();
  const mcpServer = createTextProcessingServer({ sonosApiBaseUrl, sonosApiTimeoutMs });
  const httpServer = http.createServer(createHttpHandler(mcpServer, transports, path));

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, resolve);
  });

  const address = httpServer.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;

  return {
    host,
    port: actualPort,
    path,
    url: `http://${host}:${actualPort}${path}`,
    httpServer,
    async close() {
      await Promise.all(Array.from(transports.values(), (transport) => transport.close()));
      transports.clear();
      await new Promise((resolve, reject) => {
        httpServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
  };
}

export { createTextProcessingServer };
