const { query } = require('../config/db');

function mapCategory(row) {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const categoryRepository = {
  mapCategory,

  async findAll() {
    const res = await query(
      'SELECT * FROM categories ORDER BY sort_order ASC, name ASC'
    );
    return res.rows.map(mapCategory);
  },

  async findById(id) {
    const res = await query('SELECT * FROM categories WHERE id = $1', [id]);
    return mapCategory(res.rows[0]);
  },

  async findByName(name) {
    const res = await query(
      'SELECT * FROM categories WHERE LOWER(name) = LOWER($1)',
      [name]
    );
    return mapCategory(res.rows[0]);
  },

  async create(data) {
    const sql = `
      INSERT INTO categories (name, sort_order)
      VALUES ($1, $2)
      RETURNING *
    `;
    const res = await query(sql, [data.name, data.sortOrder || 0]);
    return mapCategory(res.rows[0]);
  },

  async update(id, data) {
    const fields = [];
    const params = [id];

    if (data.name !== undefined) {
      params.push(data.name);
      fields.push(`name = $${params.length}`);
    }
    if (data.sortOrder !== undefined) {
      params.push(data.sortOrder);
      fields.push(`sort_order = $${params.length}`);
    }
    if (fields.length === 0) return this.findById(id);

    fields.push('updated_at = CURRENT_TIMESTAMP');
    const sql = `UPDATE categories SET ${fields.join(', ')} WHERE id = $1 RETURNING *`;
    const res = await query(sql, params);
    return mapCategory(res.rows[0]);
  },

  async delete(id) {
    const res = await query(
      'DELETE FROM categories WHERE id = $1 RETURNING *',
      [id]
    );
    return mapCategory(res.rows[0]);
  },
};

module.exports = categoryRepository;
