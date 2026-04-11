const MAX_TEXT_LENGTH = 4000;

export class ChatTextValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ChatTextValidationError';
  }
}

function looksLikeStructuredPayload(text) {
  const trimmed = text.trim();

  if (!trimmed || !/^[\[{]/.test(trimmed)) {
    return false;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return Boolean(parsed) && typeof parsed === 'object';
  } catch {
    return false;
  }
}

export function normalizeChatText(text) {
  if (typeof text !== 'string') {
    throw new ChatTextValidationError('Expected plain text input as a string.');
  }

  if (text.length > MAX_TEXT_LENGTH) {
    throw new ChatTextValidationError(`Chat text must be ${MAX_TEXT_LENGTH} characters or fewer.`);
  }

  if (/\0/.test(text)) {
    throw new ChatTextValidationError('Chat text must not contain null bytes.');
  }

  const normalizedText = text
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!normalizedText) {
    throw new ChatTextValidationError('Chat text must not be empty.');
  }

  if (looksLikeStructuredPayload(normalizedText)) {
    throw new ChatTextValidationError('Chat text must be simple plain text, not a serialized object or array.');
  }

  return {
    originalLength: text.length,
    normalizedLength: normalizedText.length,
    normalizedText,
    changed: normalizedText !== text
  };
}

export { MAX_TEXT_LENGTH };
