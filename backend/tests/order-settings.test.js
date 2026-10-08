const assert = require('node:assert/strict');
const { test } = require('node:test');

// ── Repositories that order.service depends on ──────────────────────────────
const settingsRepository = require('../src/repositories/settingsRepository');
const orderRepository = require('../src/repositories/orderRepository');
const productRepository = require('../src/repositories/productRepository');

let placeOrder;
let updateOrderStatus;
let expirePayAtShopOrders;

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
