const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Pool } = require('pg');

const settingsRepository = require('../src/repositories/settingsRepository');
const orderRepository = require('../src/repositories/orderRepository');
const productRepository = require('../src/repositories/productRepository');
const cartRepository = require('../src/repositories/cartRepository');
const userRepository = require('../src/repositories/userRepository');
const notificationRepository = require('../src/repositories/notificationRepository');
const cloudinaryService = require('../src/services/cloudinary.service');
const checkoutSchema = require('../src/utils/checkoutValidation');
const { placeOrder } = require('../src/services/order.service');

const TEST_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/FioAAAAASUVORK5CYII=';

function mockOrderEnv(context, { deletedIdsCollector = [] } = {}) {
  const dbQueries = [];
  const client = {
    async query(...args) {
      dbQueries.push(args);
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };

  context.mock.method(Pool.prototype, 'connect', async () => client);
  context.mock.method(settingsRepository, 'getSettings', async () => ({
    acceptingOrders: true,
    deliveryEnabled: true,
    pickupEnabled: true,
    gcashEnabled: true,
    codEnabled: true,
    payAtShopEnabled: true,
    minimumOrder: 0,
    deliveryFee: 25,
  }));

  context.mock.method(cartRepository, 'findByIds', async (ids, userId) => {
    return ids.map((id) => ({
      id,
      quantity: 1,
      addons: [],
      product: {
        id: `prod-${id}`,
        name: `Product ${id}`,
        price: 150,
        stock: 10,
        isAvailable: true,
      },
    }));
  });

  context.mock.method(productRepository, 'deductStock', async () => ({
    stock: 9,
    isAvailable: true,
  }));

  context.mock.method(cartRepository, 'deleteMany', async (ids, userId) => {
    deletedIdsCollector.push(...ids);
    return { deletedCount: ids.length };
  });

  let createdOrder = null;
  context.mock.method(orderRepository, 'create', async (data) => {
    createdOrder = { ...data, id: 'test-order-id' };
    return createdOrder;
  });

  context.mock.method(orderRepository, 'findByOrderNumber', async () => null);
  context.mock.method(productRepository, 'findById', async (id) => ({
    id,
    stock: 10,
    isAvailable: true,
  }));
  context.mock.method(userRepository, 'findById', async () => null);
  context.mock.method(notificationRepository, 'create', async () => {});
  context.mock.method(cloudinaryService, 'isConfigured', () => false);

  return {
    dbQueries,
    getCreatedOrder: () => createdOrder,
  };
}

const validContact = {
  firstName: 'Juan',
  lastName: 'Dela Cruz',
  fullName: 'Juan Dela Cruz',
  email: 'juan@example.com',
  phone: '09171234567',
};

test('BUG 1 - GCash checkout succeeds with only 13-digit reference number (no image)', async (context) => {
  const deletedIds = [];
  const { getCreatedOrder } = mockOrderEnv(context, { deletedIdsCollector: deletedIds });

  const order = await placeOrder({
    userId: 'user-123',
    cartItemIds: ['item-1'],
    fulfillment: 'pickup',
    paymentMethod: 'gcash',
    gcashReference: '1234567890123',
    contact: validContact,
  });

  assert.ok(order);
  assert.equal(order.paymentMethod, 'gcash');
  assert.equal(order.gcashReference, '1234567890123');
  assert.equal(order.paymentStatus, 'unpaid'); // manual payment, remains unpaid
  assert.equal(order.paymentProof, null);
});

test('BUG 1 - GCash checkout succeeds with only confirmation picture (no reference number)', async (context) => {
  const deletedIds = [];
  const { getCreatedOrder } = mockOrderEnv(context, { deletedIdsCollector: deletedIds });

  const order = await placeOrder({
    userId: 'user-123',
    cartItemIds: ['item-1'],
    fulfillment: 'pickup',
    paymentMethod: 'gcash',
    gcashReference: '',
    gcashProofData: TEST_PNG_BASE64,
    gcashProofMimeType: 'image/png',
    contact: validContact,
  });

  assert.ok(order);
  assert.equal(order.paymentMethod, 'gcash');
  assert.equal(order.gcashReference, '');
  assert.equal(order.paymentStatus, 'unpaid');
  assert.ok(order.paymentProof);
  assert.equal(order.paymentProof.mimeType, 'image/png');
});

test('BUG 1 - GCash checkout succeeds with both reference number and confirmation picture', async (context) => {
  const deletedIds = [];
  const { getCreatedOrder } = mockOrderEnv(context, { deletedIdsCollector: deletedIds });

  const order = await placeOrder({
    userId: 'user-123',
    cartItemIds: ['item-1'],
    fulfillment: 'pickup',
    paymentMethod: 'gcash',
    gcashReference: '9876543210987',
    gcashProofData: TEST_PNG_BASE64,
    gcashProofMimeType: 'image/png',
    contact: validContact,
  });

  assert.ok(order);
  assert.equal(order.paymentMethod, 'gcash');
  assert.equal(order.gcashReference, '9876543210987');
  assert.equal(order.paymentStatus, 'unpaid');
  assert.ok(order.paymentProof);
});

test('BUG 1 - GCash checkout is blocked when neither reference number nor confirmation picture is provided', async (context) => {
  mockOrderEnv(context);

  await assert.rejects(
    async () => {
      await placeOrder({
        userId: 'user-123',
        cartItemIds: ['item-1'],
        fulfillment: 'pickup',
        paymentMethod: 'gcash',
        gcashReference: '',
        contact: validContact,
      });
    },
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.equal(
        err.message,
        'Please provide either a GCash reference number or a payment confirmation picture.'
      );
      return true;
    }
  );
});

test('BUG 1 - Schema validation rejects empty GCash proof with matching error message', () => {
  const parsed = checkoutSchema.safeParse({
    cartItemIds: ['item-1'],
    fulfillment: 'pickup',
    paymentMethod: 'gcash',
    gcashReference: '',
    contact: validContact,
  });

  assert.equal(parsed.success, false);
  const refIssue = parsed.error.issues.find((i) => i.path.includes('gcashReference'));
  assert.ok(refIssue);
  assert.equal(
    refIssue.message,
    'Please provide either a GCash reference number or a payment confirmation picture.'
  );
});

test('BUG 2 - Successfully ordered items are deleted from cart repository while unselected items remain', async (context) => {
  const deletedIds = [];
  mockOrderEnv(context, { deletedIdsCollector: deletedIds });

  // User checks out only item-1 out of their cart (item-2 was not selected)
  await placeOrder({
    userId: 'user-123',
    cartItemIds: ['item-1'],
    fulfillment: 'pickup',
    paymentMethod: 'gcash',
    gcashReference: '1234567890123',
    contact: validContact,
  });

  assert.deepEqual(deletedIds, ['item-1']);
  assert.ok(!deletedIds.includes('item-2'));
});

test('BUG 2 - Failed checkout does not delete any items from the cart', async (context) => {
  const deletedIds = [];
  mockOrderEnv(context, { deletedIdsCollector: deletedIds });

  // Override cart items to have quantity exceeding stock
  context.mock.method(cartRepository, 'findByIds', async () => [
    {
      id: 'item-1',
      quantity: 5,
      addons: [],
      product: {
        id: 'prod-item-1',
        name: 'Product item-1',
        price: 150,
        stock: 0, // Out of stock
        isAvailable: true,
      },
    },
  ]);

  // Order placement should fail operational validation
  await assert.rejects(async () => {
    await placeOrder({
      userId: 'user-123',
      cartItemIds: ['item-1'],
      fulfillment: 'pickup',
      paymentMethod: 'gcash',
      gcashReference: '1234567890123',
      contact: validContact,
    });
  });

  // Verify cartRepository.deleteMany was never called
  assert.equal(deletedIds.length, 0);
});

const validDeliveryContact = {
  ...validContact,
  street: '123 Rizal St',
  barangay: 'San Antonio',
  city: 'Pasig',
  province: 'Metro Manila',
  postalCode: '1600',
};

test('FULFILLMENT - Pickup with pay_at_shop removes ordered items from cart', async (context) => {
  const deletedIds = [];
  const { getCreatedOrder } = mockOrderEnv(context, { deletedIdsCollector: deletedIds });

  const order = await placeOrder({
    userId: 'user-123',
    cartItemIds: ['item-pickup-1'],
    fulfillment: 'pickup',
    paymentMethod: 'pay_at_shop',
    contact: validContact,
  });

  assert.ok(order);
  assert.equal(order.fulfillment, 'pickup');
  assert.equal(order.paymentMethod, 'pay_at_shop');
  assert.equal(order.deliveryFee, 0);
  assert.equal(order.paymentStatus, 'unpaid');
  assert.ok(order.arrivalDeadline instanceof Date);
  assert.deepEqual(deletedIds, ['item-pickup-1']);
});

test('FULFILLMENT - Delivery with COD removes ordered items from cart and includes delivery fee', async (context) => {
  const deletedIds = [];
  const { getCreatedOrder } = mockOrderEnv(context, { deletedIdsCollector: deletedIds });

  const order = await placeOrder({
    userId: 'user-123',
    cartItemIds: ['item-delivery-1'],
    fulfillment: 'delivery',
    paymentMethod: 'cod',
    contact: validDeliveryContact,
  });

  assert.ok(order);
  assert.equal(order.fulfillment, 'delivery');
  assert.equal(order.paymentMethod, 'cod');
  assert.equal(order.deliveryFee, 25);
  assert.equal(order.total, 175); // 150 subtotal + 25 delivery
  assert.equal(order.paymentStatus, 'unpaid');
  assert.equal(order.contact.address, '123 Rizal St, San Antonio, Pasig, Metro Manila, 1600');
  assert.deepEqual(deletedIds, ['item-delivery-1']);
});

test('FULFILLMENT - Delivery with GCash removes ordered items from cart', async (context) => {
  const deletedIds = [];
  const { getCreatedOrder } = mockOrderEnv(context, { deletedIdsCollector: deletedIds });

  const order = await placeOrder({
    userId: 'user-123',
    cartItemIds: ['item-delivery-gcash'],
    fulfillment: 'delivery',
    paymentMethod: 'gcash',
    gcashReference: '1234567890123',
    contact: validDeliveryContact,
  });

  assert.ok(order);
  assert.equal(order.fulfillment, 'delivery');
  assert.equal(order.paymentMethod, 'gcash');
  assert.equal(order.deliveryFee, 25);
  assert.equal(order.total, 175);
  assert.deepEqual(deletedIds, ['item-delivery-gcash']);
});

test('FULFILLMENT - Incompatible payment method for pickup (COD) is rejected and does not delete cart', async (context) => {
  const deletedIds = [];
  mockOrderEnv(context, { deletedIdsCollector: deletedIds });

  await assert.rejects(
    async () => {
      await placeOrder({
        userId: 'user-123',
        cartItemIds: ['item-pickup-cod'],
        fulfillment: 'pickup',
        paymentMethod: 'cod',
        contact: validContact,
      });
    },
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.match(err.message, /not applicable for pickup orders/i);
      return true;
    }
  );

  assert.equal(deletedIds.length, 0);
});

test('FULFILLMENT - Incompatible payment method for delivery (pay_at_shop) is rejected and does not delete cart', async (context) => {
  const deletedIds = [];
  mockOrderEnv(context, { deletedIdsCollector: deletedIds });

  await assert.rejects(
    async () => {
      await placeOrder({
        userId: 'user-123',
        cartItemIds: ['item-delivery-shop'],
        fulfillment: 'delivery',
        paymentMethod: 'pay_at_shop',
        contact: validDeliveryContact,
      });
    },
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.match(err.message, /not applicable for delivery orders/i);
      return true;
    }
  );

  assert.equal(deletedIds.length, 0);
});

