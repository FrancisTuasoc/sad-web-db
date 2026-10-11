const AppError = require('./AppError');

const MAX_GCASH_PROOF_BYTES = 3 * 1024 * 1024;
const BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function matchesImageSignature(buffer, mimeType) {
  if (mimeType === 'image/png') {
    return (
      buffer.length >= 33 &&
      buffer
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) &&
      buffer.readUInt32BE(8) === 13 &&
      buffer.toString('ascii', 12, 16) === 'IHDR' &&
      buffer.readUInt32BE(16) > 0 &&
      buffer.readUInt32BE(20) > 0 &&
      buffer.readUInt32BE(buffer.length - 12) === 0 &&
      buffer.toString('ascii', buffer.length - 8, buffer.length - 4) === 'IEND'
    );
  }
  if (mimeType === 'image/jpeg') {
    return buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff &&
      buffer[buffer.length - 2] === 0xff &&
      buffer[buffer.length - 1] === 0xd9;
  }
  if (mimeType === 'image/webp') {
    return (
      buffer.length >= 20 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.readUInt32LE(4) === buffer.length - 8 &&
      buffer.toString('ascii', 8, 12) === 'WEBP' &&
      ['VP8 ', 'VP8L', 'VP8X'].includes(buffer.toString('ascii', 12, 16))
    );
  }
  return false;
}

function validateGcashProof({ data, mimeType }) {
  if (
    typeof data !== 'string' ||
    !data ||
    data.length > Math.ceil((MAX_GCASH_PROOF_BYTES * 4) / 3) ||
    data.length % 4 !== 0 ||
    !BASE64_PATTERN.test(data)
  ) {
    throw new AppError('Upload a valid GCash payment screenshot (up to 3 MiB).', 400);
  }

  const buffer = Buffer.from(data, 'base64');
  if (
    buffer.length === 0 ||
    buffer.length > MAX_GCASH_PROOF_BYTES ||
    !matchesImageSignature(buffer, mimeType)
  ) {
    throw new AppError(
      'Use a PNG, JPEG, or WebP image no larger than 3 MiB.',
      400
    );
  }

  return { buffer, mimeType };
}

module.exports = { validateGcashProof, MAX_GCASH_PROOF_BYTES };
