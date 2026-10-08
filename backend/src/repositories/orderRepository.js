const { query, getClient } = require('../config/db');

function mapOrderRow(row) {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    orderNumber: row.order_number,
    user: row.user_username
      ? {
          _id: row.user_id,
          id: row.user_id,
          username: row.user_username,
          email: row.user_email,
        }
      : row.user_id,
    userId: row.user_id,
    subtotal: Number(row.subtotal),
    deliveryFee: Number(row.delivery_fee),
    total: Number(row.total),
    fulfillment: row.fulfillment,
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    arrivalDeadline: row.arrival_deadline,
    gcashReference: row.gcash_reference || '',
    contact: {
      fullName: row.contact_full_name,
      firstName: row.contact_first_name || '',
      lastName: row.contact_last_name || '',
      email: row.contact_email || '',
      phone: row.contact_phone,
      street: row.contact_street || '',
      barangay: row.contact_barangay || '',
      city: row.contact_city || '',
      province: row.contact_province || '',
      postalCode: row.contact_postal_code || '',
      address: row.contact_address || '',
    },
    status: row.status,
    cancelledBy: row.cancelled_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: [],
    statusHistory: [],
  };
}

async function populateOrderRelations(orders) {
  if (orders.length === 0) return [];
  const orderIds = orders.map((o) => o.id);

  // 1. Fetch Order Items
  const itemsRes = await query(
    `SELECT * FROM order_items WHERE order_id = ANY($1::uuid[]) ORDER BY id ASC`,
    [orderIds]
  );

  const itemIds = itemsRes.rows.map((i) => i.id);

  // 2. Fetch Item Addons
  let addonsByItemId = new Map();
  if (itemIds.length > 0) {
    const addonsRes = await query(
      `SELECT * FROM order_item_addons WHERE order_item_id = ANY($1::uuid[]) ORDER BY id ASC`,
      [itemIds]
    );
    for (const addon of addonsRes.rows) {
      if (!addonsByItemId.has(addon.order_item_id)) {
        addonsByItemId.set(addon.order_item_id, []);
      }
      addonsByItemId.get(addon.order_item_id).push({
        product: addon.product_id,
        productId: addon.product_id,
        name: addon.name,
        price: Number(addon.price),
        qty: addon.qty,
      });
    }
  }

  // 3. Group items by order_id
  const itemsByOrderId = new Map();
  for (const item of itemsRes.rows) {
    if (!itemsByOrderId.has(item.order_id)) {
      itemsByOrderId.set(item.order_id, []);
    }
    itemsByOrderId.get(item.order_id).push({
      _id: item.id,
      id: item.id,
      product: item.product_id,
      productId: item.product_id,
      name: item.name,
      unitPrice: Number(item.unit_price),
      quantity: item.quantity,
      addonQuantityMode: item.addon_quantity_mode,
      lineTotal: Number(item.line_total),
      addons: addonsByItemId.get(item.id) || [],
    });
  }

  // 4. Fetch Status History
  const historyRes = await query(
    `SELECT * FROM order_status_history WHERE order_id = ANY($1::uuid[]) ORDER BY at ASC`,
    [orderIds]
  );
  const historyByOrderId = new Map();
  for (const h of historyRes.rows) {
    if (!historyByOrderId.has(h.order_id)) {
      historyByOrderId.set(h.order_id, []);
    }
    historyByOrderId.get(h.order_id).push({
      status: h.status,
      at: h.at,
    });
  }

  return orders.map((o) => ({
    ...o,
    items: itemsByOrderId.get(o.id) || [],
    statusHistory: historyByOrderId.get(o.id) || [],
  }));
}

const orderRepository = {
  async findById(id, userId = null) {
    let sql = `
      SELECT o.*, u.username as user_username, u.email as user_email
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      WHERE o.id = $1
    `;
    const params = [id];
    if (userId) {
      params.push(userId);
      sql += ' AND o.user_id = $2';
    }
    const res = await query(sql, params);
    if (!res.rows[0]) return null;
    const [fullOrder] = await populateOrderRelations([
      mapOrderRow(res.rows[0]),
    ]);
    return fullOrder;
  },

  async findByOrderNumber(orderNumber) {
    const sql = `
      SELECT o.*, u.username as user_username, u.email as user_email
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      WHERE o.order_number = $1
    `;
    const res = await query(sql, [orderNumber]);
    if (!res.rows[0]) return null;
    const [fullOrder] = await populateOrderRelations([
      mapOrderRow(res.rows[0]),
    ]);
    return fullOrder;
  },

  async find(filter = {}, options = {}) {
    let sql = `
      SELECT o.*, u.username as user_username, u.email as user_email
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (filter.user || filter.userId) {
      params.push(filter.user || filter.userId);
      sql += ` AND o.user_id = $${params.length}`;
    }

    if (filter.status) {
      if (Array.isArray(filter.status)) {
        params.push(filter.status);
        sql += ` AND o.status = ANY($${params.length}::order_status[])`;
      } else {
        params.push(filter.status);
        sql += ` AND o.status = $${params.length}`;
      }
    }

    if (filter.paymentStatus) {
      params.push(filter.paymentStatus);
      sql += ` AND o.payment_status = $${params.length}`;
    }

    if (filter.paymentMethod) {
      params.push(filter.paymentMethod);
      sql += ` AND o.payment_method = $${params.length}`;
    }

    if (filter.arrivalDeadlineLte) {
      params.push(filter.arrivalDeadlineLte);
      sql += ` AND o.arrival_deadline <= $${params.length}`;
    }

    if (filter.search && filter.search.trim()) {
      params.push(`%${filter.search.trim()}%`);
      sql += ` AND (o.order_number ILIKE $${params.length} OR o.contact_full_name ILIKE $${params.length} OR o.contact_phone ILIKE $${params.length})`;
    }

    sql += ' ORDER BY o.created_at DESC';

    if (options.limit) {
      params.push(Number(options.limit));
      sql += ` LIMIT $${params.length}`;
    }

    if (options.offset) {
      params.push(Number(options.offset));
      sql += ` OFFSET $${params.length}`;
    }

    const res = await query(sql, params);
    const mapped = res.rows.map(mapOrderRow);
    return populateOrderRelations(mapped);
  },

  async count(filter = {}) {
    let sql = 'SELECT COUNT(*)::int as count FROM orders WHERE 1=1';
    const params = [];

    if (filter.user || filter.userId) {
      params.push(filter.user || filter.userId);
      sql += ` AND user_id = $${params.length}`;
    }
    if (filter.status) {
      if (Array.isArray(filter.status)) {
        params.push(filter.status);
        sql += ` AND status = ANY($${params.length}::order_status[])`;
      } else {
        params.push(filter.status);
        sql += ` AND status = $${params.length}`;
      }
    }

    const res = await query(sql, params);
    return res.rows[0].count;
  },

  async create(orderData, client = null) {
    const q = client ? client.query.bind(client) : query;
    const {
      orderNumber,
      userId,
      subtotal,
      deliveryFee = 0,
      total,
      fulfillment,
      paymentMethod,
      paymentStatus = 'unpaid',
      arrivalDeadline = null,
      gcashReference = '',
      contact = {},
      status = 'pending',
      items = [],
    } = orderData;

    const insertOrderSql = `
      INSERT INTO orders (
        order_number, user_id, subtotal, delivery_fee, total,
        fulfillment, payment_method, payment_status, arrival_deadline,
        gcash_reference, contact_full_name, contact_first_name,
        contact_last_name, contact_email, contact_phone, contact_street,
        contact_barangay, contact_city, contact_province, contact_postal_code,
        contact_address, status
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22
      ) RETURNING *
    `;

    const orderRes = await q(insertOrderSql, [
      orderNumber,
      userId,
      subtotal,
      deliveryFee,
      total,
      fulfillment,
      paymentMethod,
      paymentStatus,
      arrivalDeadline,
      gcashReference || '',
      contact.fullName || '',
      contact.firstName || '',
      contact.lastName || '',
      contact.email || '',
      contact.phone || '',
      contact.street || '',
      contact.barangay || '',
      contact.city || '',
      contact.province || '',
      contact.postalCode || '',
      contact.address || '',
      status,
    ]);

    const orderId = orderRes.rows[0].id;

    // Insert order items
    for (const item of items) {
      const prodId =
        item.product && item.product._id ? item.product._id : item.product;
      const itemSql = `
        INSERT INTO order_items (
          order_id, product_id, name, unit_price, quantity,
          addon_quantity_mode, line_total
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
      `;
      const itemRes = await q(itemSql, [
        orderId,
        prodId,
        item.name,
        item.unitPrice,
        item.quantity,
        item.addonQuantityMode || 'per_item',
        item.lineTotal,
      ]);
      const orderItemId = itemRes.rows[0].id;

      if (item.addons && Array.isArray(item.addons)) {
        for (const addon of item.addons) {
          const addonProdId =
            addon.product && addon.product._id
              ? addon.product._id
              : addon.product;
          await q(
            `INSERT INTO order_item_addons (order_item_id, product_id, name, price, qty)
             VALUES ($1, $2, $3, $4, $5)`,
            [orderItemId, addonProdId, addon.name, addon.price, addon.qty || 1]
          );
        }
      }
    }

    // Insert status history
    await q(
      `INSERT INTO order_status_history (order_id, status, at) VALUES ($1, $2, CURRENT_TIMESTAMP)`,
      [orderId, status]
    );

    return this.findById(orderId);
  },

  async updateStatus(
    id,
    newStatus,
    historyEntry = null,
    extraUpdates = {},
    client = null
  ) {
    const q = client ? client.query.bind(client) : query;
    const fields = [`status = $2`, `updated_at = CURRENT_TIMESTAMP`];
    const params = [id, newStatus];

    if (extraUpdates.cancelledBy !== undefined) {
      params.push(extraUpdates.cancelledBy);
      fields.push(`cancelled_by = $${params.length}`);
    }
    if (extraUpdates.paymentStatus !== undefined) {
      params.push(extraUpdates.paymentStatus);
      fields.push(`payment_status = $${params.length}`);
    }

    const sql = `UPDATE orders SET ${fields.join(', ')} WHERE id = $1 RETURNING *`;
    const res = await q(sql, params);
    if (!res.rows[0]) return null;

    const histAt =
      historyEntry && historyEntry.at ? historyEntry.at : new Date();
    await q(
      `INSERT INTO order_status_history (order_id, status, at) VALUES ($1, $2, $3)`,
      [id, newStatus, histAt]
    );

    return this.findById(id);
  },

  async markPaid(id, client = null) {
    const q = client ? client.query.bind(client) : query;
    const sql = `
      UPDATE orders
      SET payment_status = 'paid', updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `;
    const res = await q(sql, [id]);
    if (!res.rows[0]) return null;
    return this.findById(id);
  },
};

module.exports = orderRepository;
