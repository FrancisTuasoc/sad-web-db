const { query, getClient } = require('../config/db');

function mapCartProduct(row, prefix = 'product_') {
  if (!row || !row[`${prefix}id`]) return null;
  return {
    _id: row[`${prefix}id`],
    id: row[`${prefix}id`],
    name: row[`${prefix}name`],
    slug: row[`${prefix}slug`],
    price: Number(row[`${prefix}price`]),
    stock: Number(row[`${prefix}stock`]),
    image: row[`${prefix}image`] || '',
    isAvailable: Boolean(row[`${prefix}is_available`]),
    isAddon: Boolean(row[`${prefix}is_addon`]),
  };
}

async function attachAddons(cartItems) {
  if (cartItems.length === 0) return [];
  const cartItemIds = cartItems.map((c) => c.id);

  const sql = `
    SELECT 
      cia.id as addon_id,
      cia.cart_item_id,
      cia.qty,
      p.id as product_id,
      p.name as product_name,
      p.slug as product_slug,
      p.price as product_price,
      p.stock as product_stock,
      p.image as product_image,
      p.is_available as product_is_available,
      p.is_addon as product_is_addon
    FROM cart_item_addons cia
    JOIN products p ON cia.product_id = p.id
    WHERE cia.cart_item_id = ANY($1::uuid[])
  `;
  const res = await query(sql, [cartItemIds]);

  const addonMap = new Map();
  for (const row of res.rows) {
    if (!addonMap.has(row.cart_item_id)) {
      addonMap.set(row.cart_item_id, []);
    }
    addonMap.get(row.cart_item_id).push({
      product: {
        _id: row.product_id,
        id: row.product_id,
        name: row.product_name,
        slug: row.product_slug,
        price: Number(row.product_price),
        stock: Number(row.product_stock),
        image: row.product_image || '',
        isAvailable: Boolean(row.product_is_available),
        isAddon: Boolean(row.product_is_addon),
      },
      qty: row.qty,
    });
  }

  return cartItems.map((c) => ({
    ...c,
    addons: addonMap.get(c.id) || [],
  }));
}

const cartRepository = {
  async findByUser(userId) {
    const sql = `
      SELECT 
        ci.id,
        ci.user_id,
        ci.product_id,
        ci.addon_quantity_mode,
        ci.quantity,
        ci.created_at,
        ci.updated_at,
        p.id as product_id,
        p.name as product_name,
        p.slug as product_slug,
        p.price as product_price,
        p.stock as product_stock,
        p.image as product_image,
        p.is_available as product_is_available,
        p.is_addon as product_is_addon
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      WHERE ci.user_id = $1
      ORDER BY ci.created_at DESC
    `;
    const res = await query(sql, [userId]);
    const items = res.rows.map((row) => ({
      _id: row.id,
      id: row.id,
      user: row.user_id,
      product: mapCartProduct(row),
      addonQuantityMode: row.addon_quantity_mode,
      quantity: row.quantity,
      addons: [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
    return attachAddons(items);
  },

  async findById(id, userId = null) {
    let sql = `
      SELECT 
        ci.id,
        ci.user_id,
        ci.product_id,
        ci.addon_quantity_mode,
        ci.quantity,
        ci.created_at,
        ci.updated_at,
        p.id as product_id,
        p.name as product_name,
        p.slug as product_slug,
        p.price as product_price,
        p.stock as product_stock,
        p.image as product_image,
        p.is_available as product_is_available,
        p.is_addon as product_is_addon
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      WHERE ci.id = $1
    `;
    const params = [id];
    if (userId) {
      params.push(userId);
      sql += ' AND ci.user_id = $2';
    }
    const res = await query(sql, params);
    if (!res.rows[0]) return null;
    const row = res.rows[0];
    const item = {
      _id: row.id,
      id: row.id,
      user: row.user_id,
      product: mapCartProduct(row),
      addonQuantityMode: row.addon_quantity_mode,
      quantity: row.quantity,
      addons: [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
    const [fullItem] = await attachAddons([item]);
    return fullItem;
  },

  async findByIds(ids, userId) {
    if (!ids || ids.length === 0) return [];
    const sql = `
      SELECT 
        ci.id,
        ci.user_id,
        ci.product_id,
        ci.addon_quantity_mode,
        ci.quantity,
        ci.created_at,
        ci.updated_at,
        p.id as product_id,
        p.name as product_name,
        p.slug as product_slug,
        p.price as product_price,
        p.stock as product_stock,
        p.image as product_image,
        p.is_available as product_is_available,
        p.is_addon as product_is_addon
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      WHERE ci.id = ANY($1::uuid[]) AND ci.user_id = $2
    `;
    const res = await query(sql, [ids, userId]);
    const items = res.rows.map((row) => ({
      _id: row.id,
      id: row.id,
      user: row.user_id,
      product: mapCartProduct(row),
      addonQuantityMode: row.addon_quantity_mode,
      quantity: row.quantity,
      addons: [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
    return attachAddons(items);
  },

  async create({
    userId,
    productId,
    quantity,
    addonQuantityMode,
    addons = [],
  }) {
    const client = await getClient();
    try {
      await client.query('BEGIN');
      const insertSql = `
        INSERT INTO cart_items (user_id, product_id, quantity, addon_quantity_mode)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `;
      const res = await client.query(insertSql, [
        userId,
        productId,
        quantity || 1,
        addonQuantityMode || 'per_item',
      ]);
      const cartItemId = res.rows[0].id;

      for (const addon of addons) {
        const addonProdId =
          addon.product && addon.product._id
            ? addon.product._id
            : addon.product;
        await client.query(
          'INSERT INTO cart_item_addons (cart_item_id, product_id, qty) VALUES ($1, $2, $3)',
          [cartItemId, addonProdId, addon.qty || 1]
        );
      }

      await client.query('COMMIT');
      return this.findById(cartItemId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async update(id, userId, { quantity, addonQuantityMode, addons }) {
    const client = await getClient();
    try {
      await client.query('BEGIN');
      if (quantity !== undefined || addonQuantityMode !== undefined) {
        const updates = [];
        const params = [id, userId];
        if (quantity !== undefined) {
          params.push(quantity);
          updates.push(`quantity = $${params.length}`);
        }
        if (addonQuantityMode !== undefined) {
          params.push(addonQuantityMode);
          updates.push(`addon_quantity_mode = $${params.length}`);
        }
        updates.push('updated_at = CURRENT_TIMESTAMP');
        await client.query(
          `UPDATE cart_items SET ${updates.join(', ')} WHERE id = $1 AND user_id = $2`,
          params
        );
      }

      if (addons !== undefined) {
        await client.query(
          'DELETE FROM cart_item_addons WHERE cart_item_id = $1',
          [id]
        );
        for (const addon of addons) {
          const addonProdId =
            addon.product && addon.product._id
              ? addon.product._id
              : addon.product;
          await client.query(
            'INSERT INTO cart_item_addons (cart_item_id, product_id, qty) VALUES ($1, $2, $3)',
            [id, addonProdId, addon.qty || 1]
          );
        }
      }

      await client.query('COMMIT');
      return this.findById(id, userId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async delete(id, userId) {
    const res = await query(
      'DELETE FROM cart_items WHERE id = $1 AND user_id = $2 RETURNING *',
      [id, userId]
    );
    return res.rows[0];
  },

  async deleteMany(ids, userId) {
    if (ids && ids.length > 0) {
      const res = await query(
        'DELETE FROM cart_items WHERE id = ANY($1::uuid[]) AND user_id = $2 RETURNING *',
        [ids, userId]
      );
      return { deletedCount: res.rowCount };
    }
    const res = await query(
      'DELETE FROM cart_items WHERE user_id = $1 RETURNING *',
      [userId]
    );
    return { deletedCount: res.rowCount };
  },
};

module.exports = cartRepository;
