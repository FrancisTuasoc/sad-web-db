const { query } = require('../config/db');

function mapUser(row) {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    username: row.username,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    status: row.status,
    avatarUrl: row.avatar_url || '',
    phone: row.phone || '',
    contactEmail: row.contact_email || '',
    firstName: row.first_name || '',
    lastName: row.last_name || '',
    fullName: row.full_name || '',
    street: row.street || '',
    barangay: row.barangay || '',
    city: row.city || '',
    province: row.province || '',
    postalCode: row.postal_code || '',
    address: row.address || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function safeUser(user) {
  if (!user) return null;
  const copy = { ...user };
  delete copy.passwordHash;
  return copy;
}

const userRepository = {
  mapUser,
  safeUser,

  async findById(id) {
    const res = await query('SELECT * FROM users WHERE id = $1', [id]);
    return mapUser(res.rows[0]);
  },

  async findByUsername(username) {
    const res = await query(
      'SELECT * FROM users WHERE LOWER(username) = LOWER($1)',
      [username]
    );
    return mapUser(res.rows[0]);
  },

  async findByEmail(email) {
    const res = await query(
      'SELECT * FROM users WHERE LOWER(email) = LOWER($1)',
      [email]
    );
    return mapUser(res.rows[0]);
  },

  async findByUsernameOrEmail(identifier) {
    const res = await query(
      'SELECT * FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1)',
      [identifier]
    );
    return mapUser(res.rows[0]);
  },

  async find(filter = {}) {
    let sql = 'SELECT * FROM users WHERE 1=1';
    const params = [];
    if (filter.role) {
      params.push(filter.role);
      sql += ` AND role = $${params.length}`;
    }
    if (filter.status) {
      params.push(filter.status);
      sql += ` AND status = $${params.length}`;
    }
    sql += ' ORDER BY created_at DESC';
    const res = await query(sql, params);
    return res.rows.map(mapUser);
  },

  async count(filter = {}) {
    let sql = 'SELECT COUNT(*)::int as count FROM users WHERE 1=1';
    const params = [];
    if (filter.role) {
      params.push(filter.role);
      sql += ` AND role = $${params.length}`;
    }
    const res = await query(sql, params);
    return res.rows[0].count;
  },

  async create(data) {
    const sql = `
      INSERT INTO users (
        username, email, password_hash, role, status, avatar_url, phone,
        contact_email, first_name, last_name, full_name, street, barangay,
        city, province, postal_code, address
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
      ) RETURNING *
    `;
    const params = [
      data.username,
      data.email.toLowerCase(),
      data.passwordHash,
      data.role || 'customer',
      data.status || 'active',
      data.avatarUrl || '',
      data.phone || '',
      data.contactEmail || '',
      data.firstName || '',
      data.lastName || '',
      data.fullName || '',
      data.street || '',
      data.barangay || '',
      data.city || '',
      data.province || '',
      data.postalCode || '',
      data.address || '',
    ];
    const res = await query(sql, params);
    return mapUser(res.rows[0]);
  },

  async update(id, updates) {
    const fields = [];
    const params = [id];

    const mapping = {
      username: 'username',
      email: 'email',
      passwordHash: 'password_hash',
      role: 'role',
      status: 'status',
      avatarUrl: 'avatar_url',
      phone: 'phone',
      contactEmail: 'contact_email',
      firstName: 'first_name',
      lastName: 'last_name',
      fullName: 'full_name',
      street: 'street',
      barangay: 'barangay',
      city: 'city',
      province: 'province',
      postalCode: 'postal_code',
      address: 'address',
    };

    for (const [key, col] of Object.entries(mapping)) {
      if (updates[key] !== undefined) {
        params.push(updates[key]);
        fields.push(`${col} = $${params.length}`);
      }
    }

    if (fields.length === 0) return this.findById(id);

    fields.push(`updated_at = CURRENT_TIMESTAMP`);
    const sql = `UPDATE users SET ${fields.join(', ')} WHERE id = $1 RETURNING *`;
    const res = await query(sql, params);
    return mapUser(res.rows[0]);
  },

  async delete(id) {
    const res = await query('DELETE FROM users WHERE id = $1 RETURNING *', [
      id,
    ]);
    return mapUser(res.rows[0]);
  },
};

module.exports = userRepository;
