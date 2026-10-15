const { query, closeDB } = require('../config/db');

async function backfill() {
  console.log('[BACKFILL] Checking existing orders...');
  const ordersRes = await query(`
    SELECT o.*, u.username
    FROM orders o
    LEFT JOIN users u ON o.user_id = u.id
    ORDER BY o.created_at ASC
  `);

  const historyRes = await query(`
    SELECT * FROM order_status_history
    ORDER BY at ASC
  `);

  const historyByOrder = new Map();
  for (const h of historyRes.rows) {
    if (!historyByOrder.has(h.order_id)) {
      historyByOrder.set(h.order_id, []);
    }
    historyByOrder.get(h.order_id).push(h);
  }

  let insertedCount = 0;

  for (const order of ordersRes.rows) {
    const customerName =
      order.contact_full_name || order.username || 'Customer';

    // 1. Admin notification for order placement
    await query(
      `INSERT INTO notifications (
        user_id, for_admin, order_id, title, message, type, status, is_read, created_at
      ) VALUES ($1, true, $2, $3, $4, $5, $6, true, $7)`,
      [
        null,
        order.id,
        'New Order Received',
        `Order #${order.order_number} placed by ${customerName} (${order.fulfillment.toUpperCase()}) — ₱${Number(order.total).toFixed(2)}`,
        'new_order',
        'pending',
        order.created_at,
      ]
    );
    insertedCount++;

    // 2. Customer initial notification
    await query(
      `INSERT INTO notifications (
        user_id, for_admin, order_id, title, message, type, status, is_read, created_at
      ) VALUES ($1, false, $2, $3, $4, $5, $6, true, $7)`,
      [
        order.user_id,
        order.id,
        'Order Placed',
        `Order #${order.order_number} received. Awaiting store confirmation.`,
        'order_status',
        'pending',
        order.created_at,
      ]
    );
    insertedCount++;

    // 3. Status updates from history
    const histories = historyByOrder.get(order.id) || [];
    for (const h of histories) {
      if (h.status === 'pending') continue; // already covered by placement

      let title = `Order ${h.status.replace(/_/g, ' ')}`;
      let message = `Order #${order.order_number} is now ${h.status.replace(/_/g, ' ')}.`;

      if (h.status === 'preparing') {
        title = 'Order Preparing';
        message = `Order #${order.order_number} is now being prepared.`;
      } else if (h.status === 'ready_for_pickup') {
        title = 'Ready for Pickup';
        message = `Order #${order.order_number} is ready for pickup at the store.`;
      } else if (h.status === 'ready_to_deliver') {
        title = 'Out for Delivery';
        message = `Order #${order.order_number} is out for delivery.`;
      } else if (h.status === 'completed') {
        title = 'Order Completed';
        message = `Order #${order.order_number} has been completed.`;
      } else if (h.status === 'cancelled') {
        title = 'Order Cancelled';
        message = `Order #${order.order_number} was cancelled.`;
      }

      await query(
        `INSERT INTO notifications (
          user_id, for_admin, order_id, title, message, type, status, is_read, created_at
        ) VALUES ($1, false, $2, $3, $4, $5, $6, true, $7)`,
        [
          order.user_id,
          order.id,
          title,
          message,
          h.status === 'cancelled' ? 'order_cancelled' : 'order_status',
          h.status,
          h.at,
        ]
      );
      insertedCount++;
    }
  }

  console.log(`[BACKFILL COMPLETE] Inserted ${insertedCount} historical notifications.`);
}

if (require.main === module) {
  backfill()
    .catch((err) => console.error('[BACKFILL ERROR]', err.message))
    .finally(closeDB);
}

module.exports = { backfill };
