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
        'Order Placed Successfully',
        `Your order #${order.order_number} has been received and is waiting for store acceptance.`,
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

      let title = `Order Status: ${h.status}`;
      let message = `Your order #${order.order_number} is now ${h.status}.`;

      if (h.status === 'preparing') {
        title = 'Order Accepted & Preparing';
        message = `Great news! Your order #${order.order_number} was accepted by the shop and is now being freshly prepared.`;
      } else if (h.status === 'ready_for_pickup') {
        title = 'Order Ready for Pickup';
        message = `Your order #${order.order_number} is freshly cooked and ready for pickup at our shop!`;
      } else if (h.status === 'ready_to_deliver') {
        title = 'Order Out for Delivery';
        message = `Your order #${order.order_number} has been packed and is on its way to your address!`;
      } else if (h.status === 'completed') {
        title = 'Order Completed';
        message = `Your order #${order.order_number} has been marked as completed. Thank you for choosing GIGABITE!`;
      } else if (h.status === 'cancelled') {
        title = 'Order Cancelled';
        message = `Your order #${order.order_number} has been cancelled. Reserved stock was returned.`;
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
