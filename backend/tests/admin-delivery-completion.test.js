const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const express = require('express');
const jwt = require('jsonwebtoken');

const { JWT_SECRET } = require('../src/config/env');
const errorHandler = require('../src/middleware/errorHandler');
const adminRoutes = require('../src/routes/admin.routes');
const orderRoutes = require('../src/routes/orders.routes');
const orderRepository = require('../src/repositories/orderRepository');
const userRepository = require('../src/repositories/userRepository');
const notificationRepository = require('../src/repositories/notificationRepository');
const {
  updateOrderStatus,
  completeOrder,
} = require('../src/services/order.service');

// ── Unit Tests for Service Layer ──────────────────────────────────────────

test('Admin delivery completion - eligible delivery order can be completed by admin', async (context) => {
  const order = {
    id: 'deliv-order-1',
    orderNumber: 'GB-1001',
    userId: 'user-123',
    status: 'ready_to_deliver',
    fulfillment: 'delivery',
    paymentMethod: 'cod',
    paymentStatus: 'unpaid',
  };

  context.mock.method(orderRepository, 'findById', async (id) => {
    assert.equal(id, 'deliv-order-1');
    return { ...order };
  });

  let updateStatusCalled = false;
  context.mock.method(
    orderRepository,
    'updateStatus',
    async (id, newStatus, histEntry, extra) => {
      assert.equal(id, 'deliv-order-1');
      assert.equal(newStatus, 'completed');
      assert.equal(extra.paymentStatus, 'paid'); // COD order unpaid becomes paid upon delivery completion
      assert.ok(histEntry.at instanceof Date);
      updateStatusCalled = true;
      order.status = newStatus;
      order.paymentStatus = extra.paymentStatus;
      return { ...order };
    }
  );

  let notifCreated = false;
  context.mock.method(notificationRepository, 'create', async (data) => {
    assert.equal(data.userId, 'user-123');
    assert.equal(data.forAdmin, false);
    assert.equal(data.status, 'completed');
    assert.match(data.message, /delivery confirmed/i);
    notifCreated = true;
    return data;
  });

  const updated = await updateOrderStatus('deliv-order-1', 'completed');
  assert.equal(updateStatusCalled, true);
  assert.equal(notifCreated, true);
  assert.equal(updated.status, 'completed');
  assert.equal(updated.paymentStatus, 'paid');
});

test('Admin delivery completion - supports to_ship legacy/alias status', async (context) => {
  const order = {
    id: 'deliv-order-ship',
    orderNumber: 'GB-1002',
    userId: 'user-123',
    status: 'to_ship',
    fulfillment: 'delivery',
    paymentMethod: 'cod',
    paymentStatus: 'unpaid',
  };

  context.mock.method(orderRepository, 'findById', async () => ({ ...order }));
  context.mock.method(orderRepository, 'updateStatus', async (id, newStatus, h, extra) => {
    order.status = newStatus;
    if (extra.paymentStatus) order.paymentStatus = extra.paymentStatus;
    return { ...order };
  });
  context.mock.method(notificationRepository, 'create', async () => ({}));

  const updated = await updateOrderStatus('deliv-order-ship', 'completed');
  assert.equal(updated.status, 'completed');
});

test('Admin delivery completion - GCash unpaid order remains unpaid unless manually verified', async (context) => {
  const order = {
    id: 'deliv-order-gcash',
    orderNumber: 'GB-1003',
    userId: 'user-123',
    status: 'ready_to_deliver',
    fulfillment: 'delivery',
    paymentMethod: 'gcash',
    paymentStatus: 'unpaid',
  };

  context.mock.method(orderRepository, 'findById', async () => ({ ...order }));

  let extraReceived = null;
  context.mock.method(orderRepository, 'updateStatus', async (id, newStatus, h, extra) => {
    extraReceived = extra;
    order.status = newStatus;
    return { ...order };
  });
  context.mock.method(notificationRepository, 'create', async () => ({}));

  const updated = await updateOrderStatus('deliv-order-gcash', 'completed');
  assert.equal(updated.status, 'completed');
  assert.equal(extraReceived.paymentStatus, undefined);
  assert.equal(updated.paymentStatus, 'unpaid');
});

test('Admin delivery completion - cannot complete already completed delivery order', async (context) => {
  const order = {
    id: 'deliv-order-already-completed',
    orderNumber: 'GB-1004',
    userId: 'user-123',
    status: 'completed',
    fulfillment: 'delivery',
    paymentMethod: 'cod',
    paymentStatus: 'paid',
  };

  context.mock.method(orderRepository, 'findById', async () => ({ ...order }));

  await assert.rejects(
    updateOrderStatus('deliv-order-already-completed', 'completed'),
    (error) => error.statusCode === 409 && /Cannot change order status from completed to completed/i.test(error.message)
  );
});

test('Admin delivery completion - cannot complete cancelled delivery order', async (context) => {
  const order = {
    id: 'deliv-order-cancelled',
    orderNumber: 'GB-1005',
    userId: 'user-123',
    status: 'cancelled',
    fulfillment: 'delivery',
    paymentMethod: 'cod',
    paymentStatus: 'unpaid',
  };

  context.mock.method(orderRepository, 'findById', async () => ({ ...order }));

  await assert.rejects(
    updateOrderStatus('deliv-order-cancelled', 'completed'),
    (error) => error.statusCode === 409 && /Cannot change order status from cancelled to completed/i.test(error.message)
  );
});

test('Admin delivery completion - cannot complete pending or preparing delivery order directly', async (context) => {
  for (const status of ['pending', 'preparing']) {
    const order = {
      id: `deliv-order-${status}`,
      orderNumber: 'GB-1006',
      userId: 'user-123',
      status,
      fulfillment: 'delivery',
      paymentMethod: 'cod',
      paymentStatus: 'unpaid',
    };

    context.mock.method(orderRepository, 'findById', async () => ({ ...order }));

    await assert.rejects(
      updateOrderStatus(`deliv-order-${status}`, 'completed'),
      (error) => error.statusCode === 409 && new RegExp(`Cannot change order status from ${status} to completed`, 'i').test(error.message)
    );
  }
});

test('Admin delivery completion - non-existent order returns 404', async (context) => {
  context.mock.method(orderRepository, 'findById', async () => null);

  await assert.rejects(
    updateOrderStatus('non-existent-id', 'completed'),
    (error) => error.statusCode === 404 && /Order not found/i.test(error.message)
  );
});

test('Protection of pickup workflow - pickup order ready_for_pickup can be completed by admin', async (context) => {
  const order = {
    id: 'pickup-order-1',
    orderNumber: 'GB-2001',
    userId: 'user-456',
    status: 'ready_for_pickup',
    fulfillment: 'pickup',
    paymentMethod: 'pay_at_shop',
    paymentStatus: 'unpaid',
  };

  context.mock.method(orderRepository, 'findById', async () => ({ ...order }));
  context.mock.method(orderRepository, 'updateStatus', async (id, newStatus, h, extra) => {
    order.status = newStatus;
    if (extra.paymentStatus) order.paymentStatus = extra.paymentStatus;
    return { ...order };
  });
  context.mock.method(notificationRepository, 'create', async () => ({}));

  const updated = await updateOrderStatus('pickup-order-1', 'completed');
  assert.equal(updated.status, 'completed');
  assert.equal(updated.paymentStatus, 'paid');
});

test('Protection of pickup workflow - pickup order cannot be completed if in preparing or pending', async (context) => {
  const order = {
    id: 'pickup-order-prep',
    orderNumber: 'GB-2002',
    userId: 'user-456',
    status: 'preparing',
    fulfillment: 'pickup',
    paymentMethod: 'pay_at_shop',
    paymentStatus: 'unpaid',
  };

  context.mock.method(orderRepository, 'findById', async () => ({ ...order }));

  await assert.rejects(
    updateOrderStatus('pickup-order-prep', 'completed'),
    (error) => error.statusCode === 409
  );
});

test('Protection of customer confirmation - customer can confirm order received when ready_to_deliver', async (context) => {
  const order = {
    id: 'cust-deliv-1',
    orderNumber: 'GB-3001',
    userId: 'cust-1',
    status: 'ready_to_deliver',
    fulfillment: 'delivery',
    paymentMethod: 'cod',
    paymentStatus: 'unpaid',
  };

  context.mock.method(orderRepository, 'findById', async (id, userId) => {
    assert.equal(id, 'cust-deliv-1');
    assert.equal(userId, 'cust-1');
    return { ...order };
  });
  context.mock.method(orderRepository, 'updateStatus', async (id, newStatus, h, extra) => {
    order.status = newStatus;
    if (extra.paymentStatus) order.paymentStatus = extra.paymentStatus;
    return { ...order };
  });
  context.mock.method(notificationRepository, 'create', async () => ({}));

  const completed = await completeOrder('cust-deliv-1', 'cust-1');
  assert.equal(completed.status, 'completed');
  assert.equal(completed.paymentStatus, 'paid');
});

test('Customer cannot confirm order once admin has already marked it completed', async (context) => {
  const order = {
    id: 'cust-deliv-already-admin-completed',
    orderNumber: 'GB-3002',
    userId: 'cust-1',
    status: 'completed',
    fulfillment: 'delivery',
    paymentMethod: 'cod',
    paymentStatus: 'paid',
  };

  context.mock.method(orderRepository, 'findById', async () => ({ ...order }));

  await assert.rejects(
    completeOrder('cust-deliv-already-admin-completed', 'cust-1'),
    (error) => error.statusCode === 409 && /This order is not ready to be completed/i.test(error.message)
  );
});

// ── HTTP API & Authorization Integration Tests ─────────────────────────────

let server;
let baseUrl;

const adminUserId = '11111111-1111-4111-8111-111111111111';
const customerUserId = '22222222-2222-4222-8222-222222222222';

const adminToken = jwt.sign({ id: adminUserId }, JWT_SECRET);
const customerToken = jwt.sign({ id: customerUserId }, JWT_SECRET);

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRoutes);
  app.use('/api/orders', orderRoutes);
  app.use(errorHandler);

  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

test('API Security - unauthorized customer cannot update order status via admin route', async (context) => {
  context.mock.method(userRepository, 'findById', async (id) => {
    if (id === customerUserId) {
      return { id: customerUserId, role: 'customer', status: 'active' };
    }
    return null;
  });

  const res = await fetch(`${baseUrl}/admin/orders/any-id/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${customerToken}`,
    },
    body: JSON.stringify({ status: 'completed' }),
  });

  assert.equal(res.status, 403);
  const json = await res.json();
  assert.equal(json.success, false);
  assert.match(json.message, /Admin access required/i);
});

test('API Security - unauthenticated request cannot update order status', async () => {
  const res = await fetch(`${baseUrl}/admin/orders/any-id/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'completed' }),
  });

  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.success, false);
});

test('API Integration - admin can mark eligible delivery order as completed via PATCH /api/admin/orders/:id/status', async (context) => {
  const order = {
    id: '33333333-3333-4333-8333-333333333333',
    orderNumber: 'GB-4001',
    userId: customerUserId,
    status: 'ready_to_deliver',
    fulfillment: 'delivery',
    paymentMethod: 'cod',
    paymentStatus: 'unpaid',
  };

  context.mock.method(userRepository, 'findById', async (id) => {
    if (id === adminUserId) {
      return { id: adminUserId, role: 'admin', status: 'active' };
    }
    return null;
  });

  context.mock.method(orderRepository, 'findById', async (id) => {
    if (id === order.id) return { ...order };
    return null;
  });

  context.mock.method(orderRepository, 'updateStatus', async (id, newStatus, h, extra) => {
    order.status = newStatus;
    if (extra.paymentStatus) order.paymentStatus = extra.paymentStatus;
    return { ...order };
  });

  context.mock.method(notificationRepository, 'create', async () => ({}));

  const res = await fetch(`${baseUrl}/admin/orders/${order.id}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ status: 'completed' }),
  });

  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.success, true);
  assert.equal(json.order.status, 'completed');
  assert.equal(json.order.paymentStatus, 'paid');
});

test('API Integration - admin completion rejected if order already completed', async (context) => {
  const order = {
    id: '44444444-4444-4444-8444-444444444444',
    orderNumber: 'GB-4002',
    userId: customerUserId,
    status: 'completed',
    fulfillment: 'delivery',
    paymentMethod: 'cod',
    paymentStatus: 'paid',
  };

  context.mock.method(userRepository, 'findById', async (id) => {
    if (id === adminUserId) {
      return { id: adminUserId, role: 'admin', status: 'active' };
    }
    return null;
  });

  context.mock.method(orderRepository, 'findById', async (id) => {
    if (id === order.id) return { ...order };
    return null;
  });

  const res = await fetch(`${baseUrl}/admin/orders/${order.id}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ status: 'completed' }),
  });

  assert.equal(res.status, 409);
  const json = await res.json();
  assert.equal(json.success, false);
  assert.match(json.message, /Cannot change order status from completed to completed/i);
});
