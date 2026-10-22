const assert = require('node:assert/strict');
const { test } = require('node:test');

const orderRepository = require('../src/repositories/orderRepository');
const productRepository = require('../src/repositories/productRepository');
const notificationRepository = require('../src/repositories/notificationRepository');
const { cancelOrder } = require('../src/services/order.service');
const { restoreStockForOrder } = require('../src/services/stock.service');

test('Stock restoration - customer cancels order and product stock returns to exact original quantity', async (context) => {
  // Scenario:
  // Burger starts at 15. Customer orders 3. Stock was deducted to 12.
  // Cheese add-on starts at 30. Customer orders 2 per item (2 * 3 = 6). Stock was deducted to 24.
  const currentStocks = {
    'prod-burger-1': 12,
    'prod-cheese-1': 24,
  };

  const order = {
    id: 'test-order-cancel-1',
    orderNumber: 'GB-CAN-1',
    userId: 'cust-uuid-1',
    status: 'pending',
    items: [
      {
        productId: 'prod-burger-1',
        name: 'Classic Burger',
        quantity: 3,
        addonQuantityMode: 'per_item',
        addons: [
          {
            productId: 'prod-cheese-1',
            name: 'Cheddar Cheese',
            qty: 2,
          },
        ],
      },
    ],
  };

  context.mock.method(orderRepository, 'findById', async (orderId, userId) => {
    assert.equal(orderId, 'test-order-cancel-1');
    assert.equal(userId, 'cust-uuid-1');
    return { ...order };
  });

  context.mock.method(
    orderRepository,
    'updateStatus',
    async (id, newStatus, histEntry, extra) => {
      assert.equal(newStatus, 'cancelled');
      assert.equal(extra.cancelledBy, 'customer');
      order.status = 'cancelled';
      return { ...order };
    }
  );

  context.mock.method(
    productRepository,
    'incrementStock',
    async (prodId, quantity) => {
      currentStocks[prodId] += quantity;
      return {
        _id: prodId,
        id: prodId,
        stock: currentStocks[prodId],
        isAvailable: true,
      };
    }
  );

  context.mock.method(notificationRepository, 'create', async () => ({}));

  // Customer performs cancellation
  const cancelled = await cancelOrder(
    'test-order-cancel-1',
    { id: 'cust-uuid-1', _id: 'cust-uuid-1' },
    'customer'
  );

  assert.equal(cancelled.status, 'cancelled');
  // Stock of burger restored by +3: 12 + 3 = 15
  assert.equal(currentStocks['prod-burger-1'], 15);
  // Stock of cheese restored by +6: 24 + 6 = 30
  assert.equal(currentStocks['prod-cheese-1'], 30);
});

test('Stock restoration - supports per_order add-on quantity mode', async (context) => {
  const currentStocks = {
    'prod-burger-2': 8,
    'prod-sauce-1': 19, // Ordered 1 sauce for the entire order of 4 burgers
  };

  const order = {
    id: 'test-order-cancel-2',
    orderNumber: 'GB-CAN-2',
    userId: 'cust-uuid-1',
    status: 'pending',
    items: [
      {
        productId: 'prod-burger-2',
        name: 'Bacon Deluxe',
        quantity: 4,
        addonQuantityMode: 'per_order',
        addons: [
          {
            productId: 'prod-sauce-1',
            name: 'BBQ Dip',
            qty: 1,
          },
        ],
      },
    ],
  };

  context.mock.method(orderRepository, 'findById', async () => ({ ...order }));
  context.mock.method(orderRepository, 'updateStatus', async (id, status) => {
    order.status = status;
    return { ...order };
  });
  context.mock.method(
    productRepository,
    'incrementStock',
    async (prodId, quantity) => {
      currentStocks[prodId] += quantity;
      return { _id: prodId, stock: currentStocks[prodId], isAvailable: true };
    }
  );
  context.mock.method(notificationRepository, 'create', async () => ({}));

  await cancelOrder(
    'test-order-cancel-2',
    { id: 'cust-uuid-1' },
    'customer'
  );

  // Burger restored by +4: 8 + 4 = 12
  assert.equal(currentStocks['prod-burger-2'], 12);
  // Sauce restored by +1 (per_order mode): 19 + 1 = 20
  assert.equal(currentStocks['prod-sauce-1'], 20);
});

test('Stock restoration - aggregates multiple order items referencing the same add-on', async (context) => {
  const restoredQuantities = {};

  const orderItems = [
    {
      productId: 'prod-item-1',
      quantity: 2,
      addonQuantityMode: 'per_item',
      addons: [{ productId: 'addon-shared', qty: 2 }], // 2 * 2 = 4
    },
    {
      productId: 'prod-item-2',
      quantity: 3,
      addonQuantityMode: 'per_item',
      addons: [{ productId: 'addon-shared', qty: 1 }], // 3 * 1 = 3
    },
  ];

  context.mock.method(
    productRepository,
    'incrementStock',
    async (prodId, quantity) => {
      restoredQuantities[prodId] = quantity;
      return { _id: prodId, stock: quantity, isAvailable: true };
    }
  );

  await restoreStockForOrder(orderItems);

  assert.equal(restoredQuantities['prod-item-1'], 2);
  assert.equal(restoredQuantities['prod-item-2'], 3);
  // Shared addon restored by 4 + 3 = 7
  assert.equal(restoredQuantities['addon-shared'], 7);
});

test('Cancellation safety - customer cannot cancel an order once preparing or delivered', async (context) => {
  for (const nonPendingStatus of ['preparing', 'ready_to_deliver', 'completed']) {
    const order = {
      id: `order-${nonPendingStatus}`,
      userId: 'cust-uuid-1',
      status: nonPendingStatus,
      items: [],
    };

    context.mock.method(orderRepository, 'findById', async () => ({ ...order }));

    await assert.rejects(
      cancelOrder(`order-${nonPendingStatus}`, { id: 'cust-uuid-1' }, 'customer'),
      (error) => error.statusCode === 409 && /can no longer be cancelled/i.test(error.message)
    );
  }
});

test('Cancellation safety - customer cannot cancel someone elses order', async (context) => {
  context.mock.method(orderRepository, 'findById', async (orderId, userId) => {
    // Repository returns null when userId does not match order owner
    if (userId !== 'owner-user-id') return null;
    return { id: orderId, userId: 'owner-user-id', status: 'pending' };
  });

  await assert.rejects(
    cancelOrder('other-order-id', { id: 'intruder-id' }, 'customer'),
    (error) => error.statusCode === 404 && /Order not found/i.test(error.message)
  );
});

test('Admin cancellation also restores stock correctly', async (context) => {
  const currentStocks = {
    'prod-admin-cancel': 5,
  };

  const order = {
    id: 'admin-cancel-order',
    orderNumber: 'GB-ADMIN-1',
    userId: 'cust-uuid-1',
    status: 'pending',
    items: [
      {
        productId: 'prod-admin-cancel',
        name: 'Monster Burger',
        quantity: 5,
        addons: [],
      },
    ],
  };

  context.mock.method(orderRepository, 'findById', async () => ({ ...order }));
  context.mock.method(orderRepository, 'updateStatus', async (id, status, h, extra) => {
    assert.equal(extra.cancelledBy, 'admin');
    order.status = status;
    return { ...order };
  });
  context.mock.method(
    productRepository,
    'incrementStock',
    async (prodId, quantity) => {
      currentStocks[prodId] += quantity;
      return { _id: prodId, stock: currentStocks[prodId], isAvailable: true };
    }
  );
  context.mock.method(notificationRepository, 'create', async () => ({}));

  const cancelled = await cancelOrder(
    'admin-cancel-order',
    { id: 'admin-id', role: 'admin' },
    'admin'
  );

  assert.equal(cancelled.status, 'cancelled');
  // Stock restored: 5 + 5 = 10
  assert.equal(currentStocks['prod-admin-cancel'], 10);
});
