const { query } = require('../config/db');

function mapProduct(row) {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description || '',
    price: Number(row.price),
    stock: Number(row.stock),
    lowStockThreshold: Number(row.low_stock_threshold),
    category: row.category_name
      ? {
          _id: row.category_id,
          id: row.category_id,
          name: row.category_name,
        }
      : row.category_id,
    categoryId: row.category_id,
    image: row.image || '',
    isAddon: Boolean(row.is_addon),
    isAvailable: Boolean(row.is_available),
    isFeatured: Boolean(row.is_featured),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const productRepository = {
  mapProduct,

  async find(options = {}) {
    const { category, isAddon, isAvailable, isFeatured, search, sort } =
      options;
    let sql = `
      SELECT p.*, c.name as category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE 1=1
    `;
    const params = [];

    if (category && category !== 'all') {
      params.push(category);
      sql += ` AND (p.category_id::text = $${params.length} OR LOWER(c.name) = LOWER($${params.length}))`;
    }

    if (isAddon !== undefined) {
      params.push(Boolean(isAddon));
      sql += ` AND p.is_addon = $${params.length}`;
    }

    if (isAvailable !== undefined) {
      params.push(Boolean(isAvailable));
      sql += ` AND p.is_available = $${params.length}`;
    }

    if (isFeatured !== undefined) {
      params.push(Boolean(isFeatured));
      sql += ` AND p.is_featured = $${params.length}`;
    }

    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      sql += ` AND (p.name ILIKE $${params.length} OR p.description ILIKE $${params.length})`;
    }

    // Sort
    if (sort === 'price_asc') {
      sql += ' ORDER BY p.price ASC, p.name ASC';
    } else if (sort === 'price_desc') {
      sql += ' ORDER BY p.price DESC, p.name ASC';
    } else if (sort === 'name_asc') {
      sql += ' ORDER BY p.name ASC';
    } else if (sort === 'stock_desc') {
      sql += ' ORDER BY p.stock DESC, p.name ASC';
    } else if (sort === 'featured') {
      sql += ' ORDER BY p.is_featured DESC, p.name ASC';
    } else {
      sql += ' ORDER BY p.is_featured DESC, p.created_at DESC';
    }

    const res = await query(sql, params);
    return res.rows.map(mapProduct);
  },

  async findById(id) {
    const sql = `
      SELECT p.*, c.name as category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.id = $1
    `;
    const res = await query(sql, [id]);
    return mapProduct(res.rows[0]);
  },

  async findBySlug(slug) {
    const sql = `
      SELECT p.*, c.name as category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.slug = $1
    `;
    const res = await query(sql, [slug]);
    return mapProduct(res.rows[0]);
  },

  async findByIds(ids) {
    if (!ids || ids.length === 0) return [];
    const sql = `
      SELECT p.*, c.name as category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.id = ANY($1::uuid[])
    `;
    const res = await query(sql, [ids]);
    return res.rows.map(mapProduct);
  },

  async create(data) {
    const sql = `
      INSERT INTO products (
        name, slug, description, price, stock, low_stock_threshold,
        category_id, image, is_addon, is_available, is_featured
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
      ) RETURNING *
    `;
    const params = [
      data.name,
      data.slug,
      data.description || '',
      data.price,
      data.stock || 0,
      data.lowStockThreshold || 10,
      data.categoryId || data.category,
      data.image || '',
      data.isAddon || false,
      data.isAvailable !== undefined ? data.isAvailable : true,
      data.isFeatured || false,
    ];
    const res = await query(sql, params);
    return this.findById(res.rows[0].id);
  },

  async update(id, updates) {
    const fields = [];
    const params = [id];

    const mapping = {
      name: 'name',
      slug: 'slug',
      description: 'description',
      price: 'price',
      stock: 'stock',
      lowStockThreshold: 'low_stock_threshold',
      categoryId: 'category_id',
      category: 'category_id',
      image: 'image',
      isAddon: 'is_addon',
      isAvailable: 'is_available',
      isFeatured: 'is_featured',
    };

    for (const [key, col] of Object.entries(mapping)) {
      if (updates[key] !== undefined) {
        params.push(updates[key]);
        fields.push(`${col} = $${params.length}`);
      }
    }

    if (fields.length === 0) return this.findById(id);

    fields.push('updated_at = CURRENT_TIMESTAMP');
    const sql = `UPDATE products SET ${fields.join(', ')} WHERE id = $1 RETURNING *`;
    await query(sql, params);
    return this.findById(id);
  },

  async deductStock(productId, quantity, client = null) {
    const q = client ? client.query.bind(client) : query;
    const sql = `
      UPDATE products
      SET stock = stock - $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND stock >= $2 AND is_available = true
      RETURNING *
    `;
    const res = await q(sql, [productId, quantity]);
    return mapProduct(res.rows[0]);
  },

  async incrementStock(productId, quantity, client = null) {
    const q = client ? client.query.bind(client) : query;
    const sql = `
      UPDATE products
      SET stock = stock + $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `;
    const res = await q(sql, [productId, quantity]);
    return mapProduct(res.rows[0]);
  },

  async delete(id) {
    const res = await query('DELETE FROM products WHERE id = $1 RETURNING *', [
      id,
    ]);
    return mapProduct(res.rows[0]);
  },
};

module.exports = productRepository;
