const assert = require('node:assert/strict');
const { test } = require('node:test');

const cloudinaryService = require('../src/services/cloudinary.service');
const AppError = require('../src/utils/AppError');
const env = require('../src/config/env');

test('extractPublicId correctly parses Cloudinary URLs', () => {
  // With version tag
  assert.equal(
    cloudinaryService.extractPublicId(
      'https://res.cloudinary.com/test-cloud/image/upload/v1612345678/casestudy/avatars/user_123.jpg'
    ),
    'casestudy/avatars/user_123'
  );

  // Without version tag
  assert.equal(
    cloudinaryService.extractPublicId(
      'https://res.cloudinary.com/test-cloud/image/upload/casestudy/gcash_proofs/proof_456.png'
    ),
    'casestudy/gcash_proofs/proof_456'
  );

  // Non-cloudinary / empty inputs
  assert.equal(cloudinaryService.extractPublicId(''), null);
  assert.equal(cloudinaryService.extractPublicId(null), null);
  assert.equal(cloudinaryService.extractPublicId('pgavatar:some-uuid'), null);
});

test('assertConfigured throws 503 error when Cloudinary credentials are not set', (context) => {
  const origUrl = env.CLOUDINARY_URL;
  const origName = env.CLOUDINARY_CLOUD_NAME;
  const origKey = env.CLOUDINARY_API_KEY;
  const origSecret = env.CLOUDINARY_API_SECRET;

  env.CLOUDINARY_URL = undefined;
  env.CLOUDINARY_CLOUD_NAME = undefined;
  env.CLOUDINARY_API_KEY = undefined;
  env.CLOUDINARY_API_SECRET = undefined;

  context.after(() => {
    env.CLOUDINARY_URL = origUrl;
    env.CLOUDINARY_CLOUD_NAME = origName;
    env.CLOUDINARY_API_KEY = origKey;
    env.CLOUDINARY_API_SECRET = origSecret;
  });

  assert.equal(cloudinaryService.isConfigured(), false);
  assert.throws(
    () => cloudinaryService.assertConfigured(),
    (err) => err instanceof AppError && err.statusCode === 503
  );
});

test('uploadBuffer calls cloudinary.uploader.upload_stream and resolves result', async (context) => {
  const origUrl = env.CLOUDINARY_URL;
  env.CLOUDINARY_URL = 'cloudinary://test:test@testcloud';

  const origUploadStream = cloudinaryService.cloudinary.uploader.upload_stream;
  cloudinaryService.cloudinary.uploader.upload_stream = (options, cb) => {
    return {
      end(buffer) {
        cb(null, {
          secure_url: 'https://res.cloudinary.com/testcloud/image/upload/v1/casestudy/avatars/sample.jpg',
          public_id: 'casestudy/avatars/sample',
          format: 'jpg',
          bytes: buffer.length,
          width: 256,
          height: 256,
        });
      },
    };
  };

  context.after(() => {
    env.CLOUDINARY_URL = origUrl;
    cloudinaryService.cloudinary.uploader.upload_stream = origUploadStream;
  });

  const buffer = Buffer.from('test-image-content');
  const res = await cloudinaryService.uploadBuffer(buffer, { folder: 'casestudy/avatars' });

  assert.equal(res.secureUrl, 'https://res.cloudinary.com/testcloud/image/upload/v1/casestudy/avatars/sample.jpg');
  assert.equal(res.publicId, 'casestudy/avatars/sample');
  assert.equal(res.bytes, buffer.length);
});

test('deleteImage calls cloudinary.uploader.destroy', async (context) => {
  const origUrl = env.CLOUDINARY_URL;
  env.CLOUDINARY_URL = 'cloudinary://test:test@testcloud';

  let destroyedPublicId = null;
  const origDestroy = cloudinaryService.cloudinary.uploader.destroy;
  cloudinaryService.cloudinary.uploader.destroy = async (publicId) => {
    destroyedPublicId = publicId;
    return { result: 'ok' };
  };

  context.after(() => {
    env.CLOUDINARY_URL = origUrl;
    cloudinaryService.cloudinary.uploader.destroy = origDestroy;
  });

  const res = await cloudinaryService.deleteImage('casestudy/avatars/sample');
  assert.equal(destroyedPublicId, 'casestudy/avatars/sample');
  assert.deepEqual(res, { result: 'ok' });
});

test('orderRepository.create persists image_url and public_id when provided', async (context) => {
  const database = require('../src/config/db');
  const queries = [];
  const origGetClient = database.getClient;

  database.getClient = async () => ({
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (/INSERT INTO orders/.test(sql)) {
        return { rows: [{ id: 'order-123' }] };
      }
      return { rows: [] };
    },
    release() {},
  });

  const orderRepository = require('../src/repositories/orderRepository');
  const origFindById = orderRepository.findById;
  orderRepository.findById = async (id) => ({ id });

  context.after(() => {
    database.getClient = origGetClient;
    orderRepository.findById = origFindById;
  });

  await orderRepository.create({
    orderNumber: 'ORD-TEST-1',
    userId: 'user-123',
    subtotal: 100,
    total: 100,
    fulfillment: 'pickup',
    paymentMethod: 'gcash',
    paymentStatus: 'unpaid',
    paymentProof: {
      mimeType: 'image/png',
      imageUrl: 'https://res.cloudinary.com/testcloud/image/upload/casestudy/gcash_proofs/proof_1.png',
      publicId: 'casestudy/gcash_proofs/proof_1',
    },
    contact: {
      fullName: 'Test Customer',
      phone: '09123456789',
    },
  });

  const proofInsert = queries.find(({ sql }) => /INSERT INTO order_payment_proofs/.test(sql));
  assert.ok(proofInsert);
  assert.equal(proofInsert.params[0], 'order-123');
  assert.equal(proofInsert.params[1], 'image/png');
  assert.equal(proofInsert.params[2], null);
  assert.equal(proofInsert.params[3], 'https://res.cloudinary.com/testcloud/image/upload/casestudy/gcash_proofs/proof_1.png');
  assert.equal(proofInsert.params[4], 'casestudy/gcash_proofs/proof_1');
});
