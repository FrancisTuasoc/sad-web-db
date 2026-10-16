const { query } = require('../config/db');

function mapFavorite(row) {
  if (!row) return null;
  return {
    id: row.id,
    _id: row.id,
    customerId: row.customer_id,
    itemId: row.item_id,
    addedAt: row.added_at,
    product: {
      id: row.item_id,
      _id: row.item_id,
      name: row.item_name,
      slug: row.item_slug,
      price: Number(row.item_price),
      stock: Number(row.item_stock || 0),
      isAvailable: Boolean(row.item_is_available),
      image: row.item_image || '',
      description: row.item_description || '',
      categoryName: row.category_name || '',
      averageRating: Number(row.average_rating || 0),
      reviewCount: Number(row.review_count || 0),
    },
  };
}

const favoriteRepository = {
  mapFavorite,

  async addFavorite(customerId, itemId) {
    const sql = `
      INSERT INTO favorites (customer_id, item_id)
      VALUES ($1, $2)
      ON CONFLICT (customer_id, item_id) DO NOTHING
      RETURNING *
    `;
    const res = await query(sql, [customerId, itemId]);
    return res.rows[0] || null;
  },

  async removeFavorite(customerId, itemId) {
    const sql = `
      DELETE FROM favorites
      WHERE customer_id = $1 AND item_id = $2
      RETURNING *
    `;
    const res = await query(sql, [customerId, itemId]);
    return res.rows[0] || null;
  },

  async isFavorite(customerId, itemId) {
    const sql = `
      SELECT 1 FROM favorites
      WHERE customer_id = $1 AND item_id = $2
    `;
    const res = await query(sql, [customerId, itemId]);
    return res.rowCount > 0;
  },

  async getCustomerFavoriteItemIds(customerId) {
    const sql = `
      SELECT item_id FROM favorites
      WHERE customer_id = $1
      ORDER BY added_at DESC
    `;
    const res = await query(sql, [customerId]);
    return res.rows.map((r) => r.item_id);
  },

  async getCustomerFavorites(customerId) {
    const sql = `
      SELECT 
        f.id,
        f.customer_id,
        f.item_id,
        f.added_at,
        p.name as item_name,
        p.slug as item_slug,
        p.price as item_price,
        p.stock as item_stock,
        p.is_available as item_is_available,
        p.image as item_image,
        p.description as item_description,
        c.name as category_name,
        COALESCE(ROUND(AVG(r.rating)::numeric, 1), 0.0) as average_rating,
        COUNT(DISTINCT r.id)::int as review_count
      FROM favorites f
      JOIN products p ON f.item_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN reviews r ON r.item_id = p.id
      WHERE f.customer_id = $1
      GROUP BY f.id, f.customer_id, f.item_id, f.added_at, p.id, p.name, p.slug, p.price, p.stock, p.is_available, p.image, p.description, c.name
      ORDER BY f.added_at DESC
    `;
    const res = await query(sql, [customerId]);
    return res.rows.map(mapFavorite);
  },

  async getTopFavorites(limit = 10) {
    const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);
    const sql = `
      SELECT 
        p.id as item_id,
        p.name as item_name,
        p.slug as item_slug,
        p.price as item_price,
        p.image as item_image,
        p.description as item_description,
        c.name as category_name,
        COUNT(f.id)::int as favorite_count,
        COALESCE(ROUND(AVG(r.rating)::numeric, 1), 0.0) as average_rating,
        COUNT(DISTINCT r.id)::int as review_count
      FROM favorites f
      JOIN products p ON f.item_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN reviews r ON r.item_id = p.id
      GROUP BY p.id, p.name, p.slug, p.price, p.image, p.description, c.name
      ORDER BY favorite_count DESC, average_rating DESC, p.name ASC
      LIMIT $1
    `;
    const res = await query(sql, [safeLimit]);
    return res.rows.map((row, index) => ({
      rank: index + 1,
      itemId: row.item_id,
      itemName: row.item_name,
      itemSlug: row.item_slug,
      itemPrice: Number(row.item_price),
      itemImage: row.item_image || '',
      itemDescription: row.item_description || '',
      categoryName: row.category_name || '',
      favoriteCount: Number(row.favorite_count),
      averageRating: Number(row.average_rating),
      reviewCount: Number(row.review_count),
    }));
  },
};

module.exports = favoriteRepository;
