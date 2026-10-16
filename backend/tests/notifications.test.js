const assert = require('node:assert/strict');
const { test } = require('node:test');
const notificationRepository = require('../src/repositories/notificationRepository');
const db = require('../src/config/db');

test('notificationRepository maps rows and creates notifications correctly', async (context) => {
  const dummyRow = {
    id: 'notif-1',
    user_id: 'user-1',
    for_admin: false,
    order_id: 'order-1',
    title: 'Order Preparing',
    message: 'Your order is being prepared',
    type: 'order_status',
    status: 'preparing',
    is_read: false,
    created_at: new Date('2026-10-15T12:00:00Z'),
  };

  const mapped = notificationRepository.mapNotification(dummyRow);
  assert.equal(mapped.id, 'notif-1');
  assert.equal(mapped.userId, 'user-1');
  assert.equal(mapped.forAdmin, false);
  assert.equal(mapped.isRead, false);
  assert.equal(mapped.title, 'Order Preparing');
  assert.equal(mapped.status, 'preparing');

  let executedQuery = null;
  let executedParams = null;
  context.mock.method(db, 'query', async (sql, params) => {
    executedQuery = sql;
    executedParams = params;
    return { rows: [dummyRow] };
  });

  const created = await notificationRepository.create({
    userId: 'user-1',
    forAdmin: false,
    orderId: 'order-1',
    title: 'Order Preparing',
    message: 'Your order is being prepared',
    type: 'order_status',
    status: 'preparing',
  });

  assert.equal(created.id, 'notif-1');
  assert.ok(executedQuery.includes('INSERT INTO notifications'));
  assert.equal(executedParams[0], 'user-1');
  assert.equal(executedParams[1], false);
  assert.equal(executedParams[2], 'order-1');
  assert.equal(executedParams[3], 'Order Preparing');
});

test('notificationRepository retrieves user and admin notifications and unread counts', async (context) => {
  const adminRow = {
    id: 'notif-admin',
    user_id: null,
    for_admin: true,
    order_id: 'order-1',
    title: 'New Order',
    message: 'Order placed',
    type: 'new_order',
    status: 'pending',
    is_read: false,
    created_at: new Date(),
  };

  context.mock.method(db, 'query', async (sql, params) => {
    if (sql.includes('for_admin = true AND is_read = false')) {
      return { rows: [{ count: 3 }] };
    }
    if (sql.includes('user_id = $1 AND is_read = false')) {
      return { rows: [{ count: 1 }] };
    }
    if (sql.includes('WHERE for_admin = true')) {
      return { rows: [adminRow] };
    }
    return { rows: [] };
  });

  const adminNotifs = await notificationRepository.findForAdmin({ limit: 10 });
  assert.equal(adminNotifs.length, 1);
  assert.equal(adminNotifs[0].forAdmin, true);

  const adminUnread = await notificationRepository.getUnreadCount(null, true);
  assert.equal(adminUnread, 3);

  const userUnread = await notificationRepository.getUnreadCount('user-1', false);
  assert.equal(userUnread, 1);
});

test('notificationRepository marks individual, by-order, and all notifications as read', async (context) => {
  const readRow = {
    id: 'notif-1',
    user_id: 'user-1',
    for_admin: false,
    order_id: 'order-1',
    title: 'Order Preparing',
    message: 'Your order is being prepared',
    type: 'order_status',
    status: 'preparing',
    is_read: true,
    created_at: new Date(),
  };

  const adminReadRow = {
    ...readRow,
    id: 'notif-admin',
    user_id: null,
    for_admin: true,
  };

  let lastSql = '';
  let lastParams = [];
  context.mock.method(db, 'query', async (sql, params) => {
    lastSql = sql;
    lastParams = params;
    if (sql.includes('for_admin = true') && sql.includes('UPDATE')) {
      if (sql.includes('order_id = $1')) {
        return { rows: [adminReadRow], rowCount: 1 };
      }
      return { rows: [adminReadRow], rowCount: 1 };
    }
    if (sql.includes('UPDATE notifications SET is_read = true WHERE user_id = $1')) {
      return { rows: [], rowCount: 2 };
    }
    return { rows: [readRow], rowCount: 1 };
  });

  // Mark single as read
  const resUser = await notificationRepository.markAsRead('notif-1', 'user-1', false);
  assert.equal(resUser.isRead, true);
  assert.ok(lastSql.includes('user_id = $2'));

  const resAdmin = await notificationRepository.markAsRead('notif-admin', null, true);
  assert.equal(resAdmin.isRead, true);
  assert.ok(lastSql.includes('for_admin = true'));

  // Mark by order id
  const resOrderAdmin = await notificationRepository.markAsReadByOrderId('order-1', null, true);
  assert.equal(resOrderAdmin.length, 1);
  assert.ok(lastSql.includes('order_id = $1'));
  assert.ok(lastSql.includes('for_admin = true'));

  // Mark all as read
  const adminCount = await notificationRepository.markAllAsRead(null, true);
  assert.equal(adminCount, 1);
  assert.ok(lastSql.includes('for_admin = true AND is_read = false'));

  const userCount = await notificationRepository.markAllAsRead('user-1', false);
  assert.equal(userCount, 2);
  assert.ok(lastSql.includes('user_id = $1 AND is_read = false'));
});

