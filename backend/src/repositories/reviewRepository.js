const { query } = require('../config/db');

function mapReview(row) {
  if (!row) return null;
  return {
    id: row.id,
    _id: row.id,
    itemId: row.item_id,
    customerId: row.customer_id,
    customerName: row.customer_name,
    rating: Number(row.rating),
    comment: row.comment || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    itemName: row.item_name || '',
    itemImage: row.item_image || '',
    itemPrice: row.item_price !== undefined ? Number(row.item_price) : undefined,
    itemSlug: row.item_slug || '',
    categoryName: row.category_name || '',
  };
}

const reviewRepository = {
  mapReview,

  async create({ itemId, customerId, customerName, rating, comment }) {
    const sql = `
      INSERT INTO reviews (item_id, customer_id, customer_name, rating, comment)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    const res = await query(sql, [
      itemId,
      customerId,
      customerName,
      Number(rating),
      (comment || '').trim().slice(0, 300),
    ]);
    return mapReview(res.rows[0]);
  },

  async update(id, customerId, { rating, comment }) {
    const sql = `
      UPDATE reviews
      SET rating = $1, comment = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3 AND customer_id = $4
      RETURNING *
    `;
    const res = await query(sql, [
      Number(rating),
      (comment || '').trim().slice(0, 300),
      id,
      customerId,
    ]);
    return mapReview(res.rows[0]);
  },

  async delete(id, customerId = null) {
    let sql = 'DELETE FROM reviews WHERE id = $1';
    const params = [id];

    if (customerId) {
      params.push(customerId);
      sql += ' AND customer_id = $2';
    }
    sql += ' RETURNING *';

    const res = await query(sql, params);
    return mapReview(res.rows[0]);
  },

  async findById(id) {
    const sql = `
      SELECT r.*, p.name as item_name, p.image as item_image, p.price as item_price, p.slug as item_slug
      FROM reviews r
      JOIN products p ON r.item_id = p.id
      WHERE r.id = $1
    `;
    const res = await query(sql, [id]);
    return mapReview(res.rows[0]);
  },

  async findByItem(itemId) {
    const sql = `
      SELECT r.*, p.name as item_name
      FROM reviews r
      JOIN products p ON r.item_id = p.id
      WHERE r.item_id = $1
      ORDER BY r.created_at DESC
    `;
    const res = await query(sql, [itemId]);
    return res.rows.map(mapReview);
  },

  async findByCustomer(customerId) {
    const sql = `
      SELECT r.*, p.name as item_name, p.image as item_image, p.price as item_price, p.slug as item_slug,
             c.name as category_name
      FROM reviews r
      JOIN products p ON r.item_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE r.customer_id = $1
      ORDER BY r.created_at DESC
    `;
    const res = await query(sql, [customerId]);
    return res.rows.map(mapReview);
  },

  async findCustomerReviewForItem(customerId, itemId) {
    const sql = `
      SELECT r.*, p.name as item_name
      FROM reviews r
      JOIN products p ON r.item_id = p.id
      WHERE r.customer_id = $1 AND r.item_id = $2
    `;
    const res = await query(sql, [customerId, itemId]);
    return mapReview(res.rows[0]);
  },

  async findAll({ search, rating, limit = 100, offset = 0 } = {}) {
    let sql = `
      SELECT r.*, p.name as item_name, p.image as item_image, p.price as item_price, p.slug as item_slug,
             u.email as customer_email
      FROM reviews r
      JOIN products p ON r.item_id = p.id
      JOIN users u ON r.customer_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      sql += ` AND (p.name ILIKE $${params.length} OR r.customer_name ILIKE $${params.length} OR r.comment ILIKE $${params.length})`;
    }

    if (rating && Number(rating) >= 1 && Number(rating) <= 5) {
      params.push(Number(rating));
      sql += ` AND r.rating = $${params.length}`;
    }

    sql += ' ORDER BY r.created_at DESC';

    const safeLimit = Math.min(Number(limit) || 100, 200);
    params.push(safeLimit);
    sql += ` LIMIT $${params.length}`;

    if (offset && Number(offset) > 0) {
      params.push(Number(offset));
      sql += ` OFFSET $${params.length}`;
    }

    const res = await query(sql, params);
    return res.rows.map(mapReview);
  },

  async getItemSummary(itemId) {
    const sql = `
      SELECT 
        COALESCE(ROUND(AVG(rating)::numeric, 1), 0.0) as average_rating,
        COUNT(*)::int as review_count
      FROM reviews
      WHERE item_id = $1
    `;
    const res = await query(sql, [itemId]);
    const row = res.rows[0] || {};
    return {
      averageRating: Number(row.average_rating || 0),
      reviewCount: Number(row.review_count || 0),
    };
  },

  async getAllSummaries() {
    const sql = `
      SELECT 
        item_id,
        COALESCE(ROUND(AVG(rating)::numeric, 1), 0.0) as average_rating,
        COUNT(*)::int as review_count
      FROM reviews
      GROUP BY item_id
    `;
    const res = await query(sql);
    const summaryMap = {};
    for (const row of res.rows) {
      summaryMap[row.item_id] = {
        averageRating: Number(row.average_rating || 0),
        reviewCount: Number(row.review_count || 0),
      };
    }
    return summaryMap;
  },

  async quickRate({ itemId, customerId = null, customerName = 'Guest Customer', rating }) {
    if (customerId) {
      const existing = await this.findCustomerReviewForItem(customerId, itemId);
      if (existing) {
        return this.update(existing.id, customerId, {
          rating: Number(rating),
          comment: existing.comment || '',
        });
      }
    }
    return this.create({
      itemId,
      customerId: customerId || null,
      customerName: customerName || 'Guest Customer',
      rating: Number(rating),
      comment: '',
    });
  },

  // --- Website Testimonials / Reviews ---
  async getWebsiteReviews(limit = 30) {
    const sql = `
      SELECT id, customer_id, customer_name, customer_avatar, rating, comment, created_at
      FROM website_reviews
      ORDER BY created_at DESC
      LIMIT $1
    `;
    const res = await query(sql, [Math.min(Number(limit) || 30, 100)]);
    return res.rows.map((r) => ({
      id: r.id,
      _id: r.id,
      customerId: r.customer_id,
      customerName: r.customer_name,
      customerAvatar: r.customer_avatar || '',
      rating: Number(r.rating),
      comment: r.comment || '',
      createdAt: r.created_at,
    }));
  },

  async createWebsiteReview({ customerId, customerName, customerAvatar, rating, comment }) {
    const sql = `
      INSERT INTO website_reviews (customer_id, customer_name, customer_avatar, rating, comment)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    const res = await query(sql, [
      customerId || null,
      customerName || 'Happy Customer',
      customerAvatar || '',
      Number(rating),
      (comment || '').trim().slice(0, 500),
    ]);
    const r = res.rows[0];
    return {
      id: r.id,
      _id: r.id,
      customerId: r.customer_id,
      customerName: r.customer_name,
      customerAvatar: r.customer_avatar || '',
      rating: Number(r.rating),
      comment: r.comment || '',
      createdAt: r.created_at,
    };
  },
};

module.exports = reviewRepository;
