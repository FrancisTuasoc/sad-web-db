const { query, getClient } = require('../config/db');
const { randomUUID } = require('crypto');
const AppError = require('../utils/AppError');

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const AVATAR_REQUEST_LIMIT = 6 * 1024 * 1024;
const AVATAR_STORAGE_CAP_BYTES = 400 * 1024 * 1024;

const avatarRepository = {
  AVATAR_MAX_BYTES,
  AVATAR_REQUEST_LIMIT,
  AVATAR_STORAGE_CAP_BYTES,

  async acquireLock(userId) {
    const client = await getClient();
    try {
      await client.query('BEGIN');
      const now = new Date();
      const lockUntil = new Date(now.getTime() + 10 * 60 * 1000);
      const lockToken = randomUUID();

      // Clean expired locks
      await client.query(
        'DELETE FROM customer_avatar_locks WHERE lock_until <= $1',
        [now]
      );

      const insertSql = `
        INSERT INTO customer_avatar_locks (user_id, lock_until, lock_token)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id) DO UPDATE
        SET lock_until = EXCLUDED.lock_until, lock_token = EXCLUDED.lock_token
        WHERE customer_avatar_locks.lock_until <= $4
        RETURNING lock_token
      `;
      const res = await client.query(insertSql, [
        userId,
        lockUntil,
        lockToken,
        now,
      ]);

      if (res.rows.length === 0) {
        throw new AppError(
          'A photo upload is already in progress for your account. Please try again shortly.',
          409
        );
      }

      await client.query('COMMIT');
      return lockToken;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async releaseLock(userId, lockToken) {
    await query(
      'DELETE FROM customer_avatar_locks WHERE user_id = $1 AND lock_token = $2',
      [userId, lockToken]
    );
  },

  async getStorageUsage() {
    const res = await query(
      'SELECT COUNT(*)::int as count, COALESCE(SUM(length), 0)::bigint as used_bytes FROM customer_avatars'
    );
    const usedBytes = Number(res.rows[0].used_bytes);
    return {
      avatarCount: res.rows[0].count,
      usedBytes,
      usedMiB: Number((usedBytes / (1024 * 1024)).toFixed(2)),
    };
  },

  async saveAvatar(userId, { filename, contentType, buffer }) {
    const length = buffer.length;
    const usage = await this.getStorageUsage();
    if (usage.usedBytes + length > AVATAR_STORAGE_CAP_BYTES) {
      throw new AppError(
        'Avatar storage is full. Please contact the administrator before uploading another photo.',
        507
      );
    }

    const sql = `
      INSERT INTO customer_avatars (user_id, filename, content_type, data, length)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, filename, content_type, length, created_at
    `;
    const res = await query(sql, [
      userId,
      filename,
      contentType,
      buffer,
      length,
    ]);
    return res.rows[0];
  },

  async getAvatar(id, userId = null) {
    let sql = 'SELECT * FROM customer_avatars WHERE id = $1';
    const params = [id];
    if (userId) {
      params.push(userId);
      sql += ' AND user_id = $2';
    }
    const res = await query(sql, params);
    return res.rows[0];
  },

  async deleteAvatar(id) {
    if (!id) return;
    await query('DELETE FROM customer_avatars WHERE id = $1', [id]);
  },

  async deleteAvatarByUrl(avatarUrl) {
    if (!avatarUrl) return;
    let fileId = avatarUrl;
    if (avatarUrl.startsWith('gridfs:')) {
      fileId = avatarUrl.slice('gridfs:'.length);
    } else if (avatarUrl.startsWith('pgavatar:')) {
      fileId = avatarUrl.slice('pgavatar:'.length);
    }
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        fileId
      );
    if (!isUuid) return;
    await this.deleteAvatar(fileId);
  },

  async cleanupOrphanedAvatars() {
    const sql = `
      DELETE FROM customer_avatars
      WHERE id NOT IN (
        SELECT REPLACE(REPLACE(avatar_url, 'pgavatar:', ''), 'gridfs:', '')::uuid
        FROM users
        WHERE avatar_url LIKE 'pgavatar:%' OR avatar_url LIKE 'gridfs:%'
      )
      RETURNING length
    `;
    const res = await query(sql);
    const deletedCount = res.rowCount;
    const freedBytes = res.rows.reduce((sum, r) => sum + Number(r.length), 0);
    return {
      deletedCount,
      freedBytes,
      freedMiB: Number((freedBytes / (1024 * 1024)).toFixed(2)),
    };
  },
};

module.exports = avatarRepository;
