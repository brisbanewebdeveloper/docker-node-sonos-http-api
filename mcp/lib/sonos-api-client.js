const DEFAULT_SONOS_API_BASE_URL = 'http://127.0.0.1:5005';
const DEFAULT_SONOS_API_TIMEOUT_MS = 10_000;

export class SonosApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'SonosApiError';
    this.statusCode = options.statusCode;
    this.body = options.body;
  }
}

function ensureAbsoluteBaseUrl(baseUrl) {
  try {
    return new URL(baseUrl);
  } catch {
    throw new SonosApiError('SONOS_API_BASE_URL must be an absolute http or https URL.');
  }
}

function ensureTimeout(timeoutMs) {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new SonosApiError('SONOS_API_TIMEOUT_MS must be a positive integer.');
  }

  return timeoutMs;
}

function encodeSegment(value) {
  return encodeURIComponent(value);
}

function appendOptionalValue(pathname, value) {
  if (value === undefined || value === null) {
    return pathname;
  }

  return `${pathname}/${encodeSegment(String(value))}`;
}

function toJoinedPath(baseUrl, requestPath) {
  const url = new URL(baseUrl);
  const basePath = url.pathname.replace(/\/$/, '');

  url.pathname = `${basePath}${requestPath}`;
  url.search = '';
  return url;
}

function formatUpstreamError(statusCode, body) {
  if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
    return `Sonos API returned ${statusCode}: ${body.error}`;
  }

  if (typeof body === 'string' && body.trim()) {
    return `Sonos API returned ${statusCode}: ${body.trim()}`;
  }

  return `Sonos API returned ${statusCode}.`;
}

async function parseResponseBody(response) {
  const raw = await response.text();

  if (!raw) {
    return null;
  }

  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  return raw;
}

export function validateClipName(clipName) {
  const normalizedName = String(clipName).trim();

  if (!normalizedName) {
    throw new SonosApiError('Clip name must not be empty.');
  }

  if (
    normalizedName.includes('/')
    || normalizedName.includes('\\')
    || normalizedName.includes('\0')
    || normalizedName === '.'
    || normalizedName === '..'
    || normalizedName.includes('..')
  ) {
    throw new SonosApiError('Clip name must be a simple filename without path traversal segments.');
  }

  return normalizedName;
}

export function buildSpeechRequestPath({ targetType, target, text, language, volume }) {
  if (targetType === 'preset' && volume !== undefined) {
    throw new SonosApiError('Preset speech does not support a custom volume.');
  }

  switch (targetType) {
    case 'room': {
      let pathname = `/${encodeSegment(target)}/say/${encodeSegment(text)}`;
      pathname = appendOptionalValue(pathname, language);
      pathname = appendOptionalValue(pathname, volume);
      return pathname;
    }
    case 'all': {
      let pathname = `/sayall/${encodeSegment(text)}`;
      pathname = appendOptionalValue(pathname, language);
      pathname = appendOptionalValue(pathname, volume);
      return pathname;
    }
    case 'preset': {
      let pathname = `/saypreset/${encodeSegment(target)}/${encodeSegment(text)}`;
      pathname = appendOptionalValue(pathname, language);
      return pathname;
    }
    default:
      throw new SonosApiError(`Unsupported speech target type: ${targetType}`);
  }
}

export function buildClipRequestPath({ targetType, target, clipName, volume }) {
  const safeClipName = validateClipName(clipName);

  if (targetType === 'preset' && volume !== undefined) {
    throw new SonosApiError('Preset clip playback does not support a custom volume.');
  }

  switch (targetType) {
    case 'room': {
      let pathname = `/${encodeSegment(target)}/clip/${encodeSegment(safeClipName)}`;
      pathname = appendOptionalValue(pathname, volume);
      return pathname;
    }
    case 'all': {
      let pathname = `/clipall/${encodeSegment(safeClipName)}`;
      pathname = appendOptionalValue(pathname, volume);
      return pathname;
    }
    case 'preset':
      return `/clippreset/${encodeSegment(target)}/${encodeSegment(safeClipName)}`;
    default:
      throw new SonosApiError(`Unsupported clip target type: ${targetType}`);
  }
}

export function createSonosApiClient(options = {}) {
  const baseUrl = ensureAbsoluteBaseUrl(options.baseUrl || DEFAULT_SONOS_API_BASE_URL);
  const timeoutMs = ensureTimeout(options.timeoutMs || DEFAULT_SONOS_API_TIMEOUT_MS);

  async function sendRequest(requestPath) {
    const requestUrl = toJoinedPath(baseUrl, requestPath);

    let response;

    try {
      response = await fetch(requestUrl, {
        method: 'GET',
        headers: {
          accept: 'application/json'
        },
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
        throw new SonosApiError(`Sonos API request timed out after ${timeoutMs}ms.`);
      }

      throw new SonosApiError(`Unable to reach Sonos API at ${baseUrl.origin}.`);
    }

    const body = await parseResponseBody(response);

    if (!response.ok) {
      throw new SonosApiError(formatUpstreamError(response.status, body), {
        statusCode: response.status,
        body
      });
    }

    return {
      requestPath,
      statusCode: response.status,
      body
    };
  }

  return {
    async listRooms() {
      return sendRequest('/zones');
    },
    async speak(options) {
      const requestPath = buildSpeechRequestPath(options);
      return sendRequest(requestPath);
    },
    async playClip(options) {
      const requestPath = buildClipRequestPath(options);
      return sendRequest(requestPath);
    }
  };
}

export { DEFAULT_SONOS_API_BASE_URL, DEFAULT_SONOS_API_TIMEOUT_MS };
