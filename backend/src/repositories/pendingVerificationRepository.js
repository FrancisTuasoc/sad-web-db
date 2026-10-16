const { query, getClient } = require('../config/db');
const userRepository = require('./userRepository');

const pendingVerificationRepository = {
  async cleanupExpired({ token = null, email = null } = {}) {
    // Keep the requested row intact so an expired registration can be resent.
    const result = await query(
      `DELETE FROM pending_verifications
       WHERE expires_at < NOW()
         AND ($1::text IS NULL OR token <> $1)
         AND ($2::text IS NULL OR LOWER(email) <> LOWER($2))`,
      [token, email]
    );
    return result.rowCount;
  },

  async findPendingUsername(username, exceptEmail) {
    const result = await query(
      `SELECT 1
       FROM pending_verifications
       WHERE LOWER(user_data ->> 'username') = LOWER($1)
         AND LOWER(email) <> LOWER($2)
       LIMIT 1`,
      [username, exceptEmail]
    );
    return result.rowCount > 0;
  },

  async createOrReplace({ email, token, userData, requireExisting = false }) {
    const client = await getClient();

    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext(LOWER($1)))', [
        email,
      ]);
      const existing = await client.query(
        `SELECT id, user_data,
                created_at > NOW() - INTERVAL '1 minute' AS rate_limited,
                GREATEST(
                  1,
                  CEIL(EXTRACT(EPOCH FROM (
                    created_at + INTERVAL '1 minute' - NOW()
                  )))::int
                ) AS retry_after
         FROM pending_verifications
         WHERE LOWER(email) = LOWER($1)
         ORDER BY created_at DESC
         LIMIT 1
         FOR UPDATE`,
        [email]
      );

      if (requireExisting && existing.rowCount === 0) {
        await client.query('ROLLBACK');
        return { status: 'not_found' };
      }

      if (existing.rowCount > 0 && existing.rows[0].rate_limited) {
        await client.query('ROLLBACK');
        return {
          status: 'rate_limited',
          retryAfter: Number(existing.rows[0].retry_after),
        };
      }

      const storedUserData = userData || existing.rows[0]?.user_data;
      if (!storedUserData) {
        await client.query('ROLLBACK');
        return { status: 'not_found' };
      }

      await client.query(
        'DELETE FROM pending_verifications WHERE LOWER(email) = LOWER($1)',
        [email]
      );
      await client.query(
        `INSERT INTO pending_verifications (
           email, token, user_data, expires_at
         ) VALUES ($1, $2, $3::jsonb, NOW() + INTERVAL '24 hours')`,
        [email, token, JSON.stringify(storedUserData)]
      );
      await client.query('COMMIT');
      return { status: 'created' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  async verifyToken(token) {
    const client = await getClient();

    try {
      await client.query('BEGIN');
      const pending = await client.query(
        `SELECT id, email, user_data, expires_at,
                expires_at > NOW() AS is_valid
         FROM pending_verifications
         WHERE token = $1
         FOR UPDATE`,
        [token]
      );

      if (pending.rowCount === 0) {
        await client.query('ROLLBACK');
        return { status: 'not_found' };
      }

      const row = pending.rows[0];
      if (!row.is_valid) {
        await client.query('ROLLBACK');
        return { status: 'expired' };
      }

      const registration = row.user_data;
      const created = await client.query(
        `INSERT INTO users (
           username, email, password_hash, role, status, is_verified,
           first_name, last_name, full_name
         ) VALUES ($1, $2, $3, 'customer', 'active', TRUE, $4, $5, $6)
         RETURNING *`,
        [
          registration.username,
          row.email,
          registration.passwordHash,
          registration.firstName || '',
          registration.lastName || '',
          registration.fullName ||
            `${registration.firstName || ''} ${registration.lastName || ''}`.trim(),
        ]
      );
      await client.query(
        'DELETE FROM pending_verifications WHERE LOWER(email) = LOWER($1)',
        [row.email]
      );
      await client.query('COMMIT');
      return {
        status: 'verified',
        user: userRepository.mapUser(created.rows[0]),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },
};

module.exports = pendingVerificationRepository;
