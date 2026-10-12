const { getClient, query } = require('../config/db');

const passwordResetRepository = {
  async createOrReplace(userId, tokenHash) {
    const client = await getClient();
    try {
      const result = await client.query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '30 minutes')
         ON CONFLICT (user_id) DO UPDATE
           SET token_hash = EXCLUDED.token_hash,
               expires_at = EXCLUDED.expires_at,
               created_at = NOW()
           WHERE password_reset_tokens.created_at <= NOW() - INTERVAL '15 minutes'
         RETURNING token_hash`,
        [userId, tokenHash]
      );
      return result.rowCount > 0
        ? { status: 'created' }
        : { status: 'rate_limited' };
    } finally {
      client.release();
    }
  },

  async isValid(tokenHash) {
    const result = await query(
      'SELECT 1 FROM password_reset_tokens WHERE token_hash = $1 AND expires_at > NOW()',
      [tokenHash]
    );
    return result.rowCount > 0;
  },

  async remove(tokenHash) {
    await query('DELETE FROM password_reset_tokens WHERE token_hash = $1', [
      tokenHash,
    ]);
  },

  async resetPassword(tokenHash, passwordHash) {
    const client = await getClient();
    try {
      await client.query('BEGIN');
      const tokenResult = await client.query(
        `SELECT user_id, expires_at <= NOW() AS expired
         FROM password_reset_tokens
         WHERE token_hash = $1
         FOR UPDATE`,
        [tokenHash]
      );
      const token = tokenResult.rows[0];
      if (!token) {
        await client.query('ROLLBACK');
        return { status: 'not_found' };
      }
      if (token.expired) {
        await client.query(
          'DELETE FROM password_reset_tokens WHERE token_hash = $1',
          [tokenHash]
        );
        await client.query('COMMIT');
        return { status: 'expired' };
      }

      await client.query(
        'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
        [passwordHash, token.user_id]
      );
      await client.query(
        'DELETE FROM password_reset_tokens WHERE user_id = $1',
        [token.user_id]
      );
      await client.query('COMMIT');
      return { status: 'reset' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },
};

module.exports = passwordResetRepository;
