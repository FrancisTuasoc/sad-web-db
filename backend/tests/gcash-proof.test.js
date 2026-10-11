const assert = require('node:assert/strict');
const { test } = require('node:test');
const { validateGcashProof, MAX_GCASH_PROOF_BYTES } = require('../src/utils/gcashProof');

const validPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/FioAAAAASUVORK5CYII=',
  'base64'
);

test('accepts a base64 PNG whose bytes match the declared image type', () => {
  const result = validateGcashProof({
    data: validPng.toString('base64'),
    mimeType: 'image/png',
  });

  assert.equal(result.mimeType, 'image/png');
  assert.deepEqual(result.buffer, validPng);
});

test('rejects missing, malformed, or mismatched image content', () => {
  for (const proof of [
    { data: '', mimeType: 'image/png' },
    { data: 'not base64!', mimeType: 'image/png' },
    { data: Buffer.from('not an image').toString('base64'), mimeType: 'image/png' },
    { data: validPng.toString('base64'), mimeType: 'image/jpeg' },
  ]) {
    assert.throws(() => validateGcashProof(proof), { statusCode: 400 });
  }
});

test('rejects payment screenshots larger than 3 MiB', () => {
  const oversizedImage = Buffer.alloc(MAX_GCASH_PROOF_BYTES + 1);
  oversizedImage.set(validPng);

  assert.throws(
    () =>
      validateGcashProof({
        data: oversizedImage.toString('base64'),
        mimeType: 'image/png',
      }),
    { statusCode: 400 }
  );
});
