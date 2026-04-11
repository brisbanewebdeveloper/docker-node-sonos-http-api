import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatTextValidationError, normalizeChatText } from '../lib/normalize-chat-text.js';

test('normalizeChatText trims and collapses chat whitespace', () => {
  const result = normalizeChatText('  hello   world\r\n\r\n\r\nnext\tline  ');

  assert.deepEqual(result, {
    originalLength: 32,
    normalizedLength: 22,
    normalizedText: 'hello world\n\nnext line',
    changed: true
  });
});

test('normalizeChatText rejects empty chat text', () => {
  assert.throws(
    () => normalizeChatText('   \n\t  '),
    (error) => error instanceof ChatTextValidationError && error.message === 'Chat text must not be empty.'
  );
});

test('normalizeChatText rejects serialized objects or arrays', () => {
  assert.throws(
    () => normalizeChatText('{"messages":[{"role":"user","content":"hi"}]}'),
    (error) => error instanceof ChatTextValidationError && error.message.includes('simple plain text')
  );
});

test('normalizeChatText rejects null bytes', () => {
  assert.throws(
    () => normalizeChatText('hello\0world'),
    (error) => error instanceof ChatTextValidationError && error.message === 'Chat text must not contain null bytes.'
  );
});
