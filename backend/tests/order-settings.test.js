const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Pool } = require('pg');

// ── Repositories that order.service depends on ──────────────────────────────
const settingsRepository = require('../src/repositories/settingsRepository');
const orderRepository = require('../src/repositories/orderRepository');
const productRepository = require('../src/repositories/productRepository');
const cartRepository = require('../src/repositories/cartRepository');
const userRepository = require('../src/repositories/userRepository');

let placeOrder;
let updateOrderStatus;
let expirePayAtShopOrders;

function mockSuccessfulOrderDependencies(context, settingsOverrides = {}) {
  const dbQueries = [];
  const client = {
    async query(...args) {
      dbQueries.push(args);
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  let createdOrder;

  context.mock.method(Pool.prototype, 'connect', async () => client);
  context.mock.method(settingsRepository, 'getSettings', async () => ({
    acceptingOrders: true,
    deliveryEnabled: true,
    pickupEnabled: true,
    gcashEnabled: false,
    codEnabled: true,
    payAtShopEnabled: true,
    minimumOrder: 0,
    deliveryFee: 25,
    ...settingsOverrides,
  }));
  context.mock.method(cartRepository, 'findByIds', async (ids, userId) => {
    assert.deepEqual(ids, ['cart-item']);
    assert.equal(userId, 'test-user');
    return [
      {
        id: 'cart-item',
        quantity: 2,
        addons: [],
        product: {
          id: 'test-product',
          name: 'Test Burger',
          price: 100,
          stock: 5,
          isAvailable: true,
        },
      },
    ];
  });
  context.mock.method(productRepository, 'deductStock', async () => ({
    stock: 3,
    isAvailable: true,
  }));
  context.mock.method(orderRepository, 'findByOrderNumber', async () => null);
  context.mock.method(orderRepository, 'create', async (order) => {
    createdOrder = order;
    return order;
  });
  context.mock.method(cartRepository, 'deleteMany', async () => {});
  context.mock.method(userRepository, 'findById', async () => null);

  return {
    dbQueries,
    getCreatedOrder: () => createdOrder,
  };
}

test('order placement is blocked when the admin pauses online ordering', async (context) => {
  context.mock.timers.enable({ apis: ['setInterval'] });
  ({
    placeOrder,
    updateOrderStatus,
    expirePayAtShopOrders,
  } = require('../src/services/order.service'));

  context.mock.method(settingsRepository, 'getSettings', async () => ({
    acceptingOrders: false,
  }));

  await assert.rejects(
    placeOrder({
      userId: 'user-id',
      cartItemIds: ['cart-item'],
      fulfillment: 'pickup',
      paymentMethod: 'gcash',
    }),
    (error) =>
      error.statusCode === 400 && /not accepting new orders/.test(error.message)
  );
});

test('pay-at-shop orders move through preparing before ready for pickup', async (context) => {
  let status = 'pending';
  const fakeOrder = () => ({
    id: 'order-id',
    status,
    fulfillment: 'pickup',
    paymentMethod: 'pay_at_shop',
    paymentStatus: 'unpaid',
  });

  context.mock.method(orderRepository, 'findById', async () => fakeOrder());
  context.mock.method(
    orderRepository,
    'updateStatus',
    async (id, newStatus) => {
      status = newStatus;
      return { id, status };
    }
  );

  const preparingOrder = await updateOrderStatus('order-id', 'preparing');
  assert.equal(preparingOrder.status, 'preparing');

  const readyOrder = await updateOrderStatus('order-id', 'ready_for_pickup');
  assert.equal(readyOrder.status, 'ready_for_pickup');

  await assert.rejects(
    updateOrderStatus('order-id', 'preparing'),
    (error) => error.statusCode === 409
  );
});

test('expired pay-at-shop orders are cancelled and their reserved stock is restored', async (context) => {
  const now = new Date('2026-10-07T14:00:00.000Z');
  const order = {
    id: 'order-id',
    _id: 'order-id',
    status: 'pending',
    paymentMethod: 'pay_at_shop',
    arrivalDeadline: new Date(now.getTime() - 1),
    items: [
      {
        product: 'product-id',
        productId: 'product-id',
        quantity: 2,
        addons: [],
      },
    ],
  };
  let restoredQuantity = 0;

  context.mock.method(orderRepository, 'find', async (filter) => {
    assert.equal(filter.status, 'pending');
    assert.equal(filter.paymentMethod, 'pay_at_shop');
    assert.ok(filter.arrivalDeadlineLte instanceof Date);
    return [order];
  });

  // findById is called by cancelOrder to fetch the order, then by updateStatus to return updated
  context.mock.method(orderRepository, 'findById', async () => ({ ...order }));

  context.mock.method(
    orderRepository,
    'updateStatus',
    async (id, newStatus, histEntry, extra) => {
      assert.equal(extra.cancelledBy, 'system');
      order.status = newStatus;
      return { ...order, status: newStatus };
    }
  );

  // restoreStockForOrder calls productRepository.incrementStock internally
  context.mock.method(
    productRepository,
    'incrementStock',
    async (productId, qty) => {
      restoredQuantity += qty;
      return { id: productId, _id: productId, stock: 10, isAvailable: true };
    }
  );

  assert.equal(await expirePayAtShopOrders(now), 1);
  assert.equal(order.status, 'cancelled');
  assert.equal(restoredQuantity, 2);
});

test('order placement respects disabled fulfillment and payment options', async (context) => {
  context.mock.method(settingsRepository, 'getSettings', async () => ({
    acceptingOrders: true,
    deliveryEnabled: false,
    pickupEnabled: false,
    gcashEnabled: false,
    codEnabled: false,
    payAtShopEnabled: false,
  }));

  await assert.rejects(
    placeOrder({
      userId: 'user-id',
      cartItemIds: ['cart-item'],
      fulfillment: 'delivery',
      paymentMethod: 'gcash',
    }),
    (error) =>
      error.statusCode === 400 &&
      /Delivery service is currently unavailable/.test(error.message)
  );
  await assert.rejects(
    placeOrder({
      userId: 'user-id',
      cartItemIds: ['cart-item'],
      fulfillment: 'pickup',
      paymentMethod: 'gcash',
    }),
    (error) =>
      error.statusCode === 400 &&
      /Store pickup is currently unavailable/.test(error.message)
  );
});

test('order placement blocks payment methods disabled for the selected fulfillment', async (context) => {
  context.mock.method(settingsRepository, 'getSettings', async () => ({
    acceptingOrders: true,
    deliveryEnabled: true,
    pickupEnabled: true,
    gcashEnabled: false,
    codEnabled: false,
    payAtShopEnabled: false,
  }));

  await assert.rejects(
    placeOrder({
      userId: 'user-id',
      cartItemIds: ['cart-item'],
      fulfillment: 'delivery',
      paymentMethod: 'cod',
    }),
    (error) =>
      error.statusCode === 400 &&
      /Cash on delivery is currently disabled/.test(error.message)
  );
  await assert.rejects(
    placeOrder({
      userId: 'user-id',
      cartItemIds: ['cart-item'],
      fulfillment: 'pickup',
      paymentMethod: 'pay_at_shop',
    }),
    (error) =>
      error.statusCode === 400 &&
      /Pay at shop is currently disabled/.test(error.message)
  );
});

test('pickup orders can be placed with pay-at-shop without charging payment', async (context) => {
  const { dbQueries, getCreatedOrder } = mockSuccessfulOrderDependencies(
    context
  );

  const order = await placeOrder({
    userId: 'test-user',
    cartItemIds: ['cart-item'],
    fulfillment: 'pickup',
    paymentMethod: 'pay_at_shop',
    contact: {
      firstName: 'Test',
      lastName: 'Customer',
      email: 'test@example.com',
      phone: '09171234567',
    },
  });

  assert.equal(order, getCreatedOrder());
  assert.equal(order.fulfillment, 'pickup');
  assert.equal(order.paymentMethod, 'pay_at_shop');
  assert.equal(order.paymentStatus, 'unpaid');
  assert.equal(order.subtotal, 200);
  assert.equal(order.deliveryFee, 0);
  assert.equal(order.total, 200);
  assert.ok(order.arrivalDeadline instanceof Date);
  assert.ok(dbQueries.some(([sql]) => sql === 'BEGIN'));
  assert.ok(dbQueries.some(([sql]) => sql === 'COMMIT'));
});

test('delivery orders can be placed with cash on delivery and the configured delivery fee', async (context) => {
  const { dbQueries, getCreatedOrder } = mockSuccessfulOrderDependencies(
    context
  );

  const order = await placeOrder({
    userId: 'test-user',
    cartItemIds: ['cart-item'],
    fulfillment: 'delivery',
    paymentMethod: 'cod',
    contact: {
      firstName: 'Test',
      lastName: 'Customer',
      email: 'test@example.com',
      phone: '09171234567',
      street: '10 Test Street',
      barangay: 'Test Barangay',
      city: 'Manila',
      province: 'Metro Manila',
      postalCode: '1000',
    },
  });

  assert.equal(order, getCreatedOrder());
  assert.equal(order.fulfillment, 'delivery');
  assert.equal(order.paymentMethod, 'cod');
  assert.equal(order.paymentStatus, 'unpaid');
  assert.equal(order.subtotal, 200);
  assert.equal(order.deliveryFee, 25);
  assert.equal(order.total, 225);
  assert.equal(
    order.contact.address,
    '10 Test Street, Test Barangay, Manila, Metro Manila, 1000'
  );
  assert.equal(order.arrivalDeadline, null);
  assert.ok(dbQueries.some(([sql]) => sql === 'BEGIN'));
  assert.ok(dbQueries.some(([sql]) => sql === 'COMMIT'));
});

test('GCash demo-reference orders remain unpaid and use no payment integration', async (context) => {
  const { dbQueries, getCreatedOrder } = mockSuccessfulOrderDependencies(
    context,
    { gcashEnabled: true }
  );

  const order = await placeOrder({
    userId: 'test-user',
    cartItemIds: ['cart-item'],
    fulfillment: 'pickup',
    paymentMethod: 'gcash',
    gcashReference: '0000000000000',
    contact: {
      firstName: 'Test',
      lastName: 'Customer',
      email: 'test@example.com',
      phone: '09171234567',
    },
  });

  assert.equal(order, getCreatedOrder());
  assert.equal(order.paymentMethod, 'gcash');
  assert.equal(order.gcashReference, '0000000000000');
  assert.equal(order.paymentStatus, 'unpaid');
  assert.ok(dbQueries.some(([sql]) => sql === 'BEGIN'));
  assert.ok(dbQueries.some(([sql]) => sql === 'COMMIT'));
  assert.equal(
    dbQueries.some(([sql]) => /payment gateway|gcash api/i.test(sql)),
    false
  );
});

test('GCash demo image attachments are saved for admin review and remain unpaid', async (context) => {
  const { getCreatedOrder } = mockSuccessfulOrderDependencies(context, {
    gcashEnabled: true,
  });
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/FioAAAAASUVORK5CYII=',
    'base64'
  );

  const order = await placeOrder({
    userId: 'test-user',
    cartItemIds: ['cart-item'],
    fulfillment: 'pickup',
    paymentMethod: 'gcash',
    gcashReference: '0000000000000',
    gcashProofData: png.toString('base64'),
    gcashProofMimeType: 'image/png',
    contact: {
      firstName: 'Test',
      lastName: 'Customer',
      email: 'test@example.com',
      phone: '09171234567',
    },
  });

  assert.equal(order, getCreatedOrder());
  assert.equal(order.paymentStatus, 'unpaid');
  assert.equal(order.gcashReference, '0000000000000');
  assert.equal(order.paymentProof.mimeType, 'image/png');
  assert.deepEqual(order.paymentProof.buffer, png);
});
