const { query, getClient } = require('../config/db');

const DEFAULT_HOURS = {
  monday: { open: '09:00', close: '21:00', closed: false },
  tuesday: { open: '09:00', close: '21:00', closed: false },
  wednesday: { open: '09:00', close: '21:00', closed: false },
  thursday: { open: '09:00', close: '21:00', closed: false },
  friday: { open: '09:00', close: '22:00', closed: false },
  saturday: { open: '09:00', close: '22:00', closed: false },
  sunday: { open: '10:00', close: '20:00', closed: false },
};

async function getHoursForSetting(settingsId) {
  const res = await query(
    'SELECT day_of_week, open_time, close_time, closed FROM business_hours WHERE settings_id = $1',
    [settingsId]
  );
  const hours = { ...DEFAULT_HOURS };
  for (const row of res.rows) {
    hours[row.day_of_week] = {
      open: row.open_time,
      close: row.close_time,
      closed: Boolean(row.closed),
    };
  }
  return hours;
}

function mapSettings(row, hours) {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    storeName: row.store_name,
    tagline: row.tagline,
    address: row.address,
    phone: row.phone,
    email: row.email,
    deliveryFee: Number(row.delivery_fee),
    deliveryEnabled: Boolean(row.delivery_enabled),
    pickupEnabled: Boolean(row.pickup_enabled),
    gcashEnabled: Boolean(row.gcash_enabled),
    codEnabled: Boolean(row.cod_enabled),
    payAtShopEnabled: Boolean(row.pay_at_shop_enabled),
    gcashName: row.gcash_name,
    gcashNumber: row.gcash_number,
    acceptingOrders: Boolean(row.accepting_orders),
    minimumOrder: Number(row.minimum_order),
    businessHours: hours || DEFAULT_HOURS,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const settingsRepository = {
  async getSettings() {
    let res = await query('SELECT * FROM store_settings LIMIT 1');
    if (res.rows.length === 0) {
      return this.createDefault();
    }
    const hours = await getHoursForSetting(res.rows[0].id);
    return mapSettings(res.rows[0], hours);
  },

  async createDefault(data = {}) {
    const client = await getClient();
    try {
      await client.query('BEGIN');
      const sql = `
        INSERT INTO store_settings (
          store_name, tagline, address, phone, email, delivery_fee,
          delivery_enabled, pickup_enabled, gcash_enabled, cod_enabled,
          pay_at_shop_enabled, gcash_name, gcash_number, accepting_orders,
          minimum_order
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
        ) RETURNING *
      `;
      const params = [
        data.storeName || 'Burger Shop',
        data.tagline || 'Flavor on Wheels - Freshly Grilled Everyday',
        data.address || '123 Main Street, City Center',
        data.phone || '+63 912 345 6789',
        data.email || 'hello@burgershop.com',
        data.deliveryFee !== undefined ? data.deliveryFee : 30,
        data.deliveryEnabled !== undefined ? data.deliveryEnabled : true,
        data.pickupEnabled !== undefined ? data.pickupEnabled : true,
        data.gcashEnabled !== undefined ? data.gcashEnabled : true,
        data.codEnabled !== undefined ? data.codEnabled : true,
        data.payAtShopEnabled !== undefined ? data.payAtShopEnabled : true,
        data.gcashName || 'Burger Shop HQ',
        data.gcashNumber || '09171234567',
        data.acceptingOrders !== undefined ? data.acceptingOrders : true,
        data.minimumOrder !== undefined ? data.minimumOrder : 0,
      ];
      const res = await client.query(sql, params);
      const settingsId = res.rows[0].id;

      const hours = data.businessHours || DEFAULT_HOURS;
      for (const [day, val] of Object.entries(hours)) {
        await client.query(
          `INSERT INTO business_hours (settings_id, day_of_week, open_time, close_time, closed)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (settings_id, day_of_week) DO UPDATE
           SET open_time = EXCLUDED.open_time, close_time = EXCLUDED.close_time, closed = EXCLUDED.closed`,
          [
            settingsId,
            day,
            val.open || '09:00',
            val.close || '21:00',
            Boolean(val.closed),
          ]
        );
      }

      await client.query('COMMIT');
      return mapSettings(res.rows[0], hours);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async update(updates = {}) {
    const current = await this.getSettings();
    const client = await getClient();

    try {
      await client.query('BEGIN');
      const fields = [];
      const params = [current.id];

      const mapping = {
        storeName: 'store_name',
        tagline: 'tagline',
        address: 'address',
        phone: 'phone',
        email: 'email',
        deliveryFee: 'delivery_fee',
        deliveryEnabled: 'delivery_enabled',
        pickupEnabled: 'pickup_enabled',
        gcashEnabled: 'gcash_enabled',
        codEnabled: 'cod_enabled',
        payAtShopEnabled: 'pay_at_shop_enabled',
        gcashName: 'gcash_name',
        gcashNumber: 'gcash_number',
        acceptingOrders: 'accepting_orders',
        minimumOrder: 'minimum_order',
      };

      for (const [key, col] of Object.entries(mapping)) {
        if (updates[key] !== undefined) {
          params.push(updates[key]);
          fields.push(`${col} = $${params.length}`);
        }
      }

      if (fields.length > 0) {
        fields.push('updated_at = CURRENT_TIMESTAMP');
        await client.query(
          `UPDATE store_settings SET ${fields.join(', ')} WHERE id = $1`,
          params
        );
      }

      if (updates.businessHours && typeof updates.businessHours === 'object') {
        for (const [day, val] of Object.entries(updates.businessHours)) {
          if (!val) continue;
          await client.query(
            `INSERT INTO business_hours (settings_id, day_of_week, open_time, close_time, closed)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (settings_id, day_of_week) DO UPDATE
             SET open_time = EXCLUDED.open_time, close_time = EXCLUDED.close_time, closed = EXCLUDED.closed`,
            [
              current.id,
              day,
              val.open || '09:00',
              val.close || '21:00',
              Boolean(val.closed),
            ]
          );
        }
      }

      await client.query('COMMIT');
      return this.getSettings();
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
};

module.exports = settingsRepository;
