const db = require('../config/db');

function mapNotification(row) {
  if (!row) return null;
  return {
    id: row.id,
    _id: row.id,
    userId: row.user_id,
    forAdmin: Boolean(row.for_admin),
    orderId: row.order_id,
    title: row.title,
    message: row.message,
    type: row.type,
    status: row.status,
    isRead: Boolean(row.is_read),
    createdAt: row.created_at,
  };
}

const notificationRepository = {
  mapNotification,

  async create(data) {
    const sql = `
      INSERT INTO notifications (
        user_id, for_admin, order_id, title, message, type, status, is_read
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, false
      ) RETURNING *
    `;
    const params = [
      data.userId || null,
      Boolean(data.forAdmin),
      data.orderId || null,
      data.title,
      data.message,
      data.type || 'order_status',
      data.status || null,
    ];
    const res = await db.query(sql, params);
    return mapNotification(res.rows[0]);
  },

  async findByUser(userId, { limit = 30 } = {}) {
    const sql = `
      SELECT * FROM notifications
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `;
    const res = await db.query(sql, [userId, Math.max(1, limit)]);
    return res.rows.map(mapNotification);
  },

  async findForAdmin({ limit = 30 } = {}) {
    const sql = `
      SELECT * FROM notifications
      WHERE for_admin = true
      ORDER BY created_at DESC
      LIMIT $1
    `;
    const res = await db.query(sql, [Math.max(1, limit)]);
    return res.rows.map(mapNotification);
  },

  async getUnreadCount(userId = null, forAdmin = false) {
    if (forAdmin) {
      const sql = `SELECT COUNT(*)::int as count FROM notifications WHERE for_admin = true AND is_read = false`;
      const res = await db.query(sql);
      return res.rows[0] ? res.rows[0].count : 0;
    }
    const sql = `SELECT COUNT(*)::int as count FROM notifications WHERE user_id = $1 AND is_read = false`;
    const res = await db.query(sql, [userId]);
    return res.rows[0] ? res.rows[0].count : 0;
  },

  async markAsRead(id, userId = null, forAdmin = false) {
    if (forAdmin) {
      const sql = `UPDATE notifications SET is_read = true WHERE id = $1 AND for_admin = true RETURNING *`;
      const res = await db.query(sql, [id]);
      return mapNotification(res.rows[0]);
    }
    const sql = `UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2 RETURNING *`;
    const res = await db.query(sql, [id, userId]);
    return mapNotification(res.rows[0]);
  },

  async markAllAsRead(userId = null, forAdmin = false) {
    if (forAdmin) {
      const sql = `UPDATE notifications SET is_read = true WHERE for_admin = true AND is_read = false`;
      const res = await db.query(sql);
      return res.rowCount;
    }
    const sql = `UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false`;
    const res = await db.query(sql, [userId]);
    return res.rowCount;
  },
};

module.exports = notificationRepository;
