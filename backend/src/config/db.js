const { Pool } = require('pg');
const { DATABASE_URL } = require('./env');

let pool = null;

function getPool(connectionString = DATABASE_URL) {
  if (!pool) {
    pool = new Pool({
      connectionString,
      connectionTimeoutMillis: 10000,
      max: 10,
      ssl: {
        rejectUnauthorized: false,
      },
      onConnect: async (client) => {
        await client.query('SET search_path TO app, public');
      },
    });

    pool.on('error', (err) => {
      console.error('[PostgreSQL POOL ERROR]', err.message);
    });
  }
  return pool;
}

async function connectDB(connectionString) {
  const p = getPool(connectionString);
  try {
    const client = await p.connect();
    const res = await client.query(
      'SELECT current_database() as db_name, current_user as user_name'
    );
    client.release();
    console.log(
      `PostgreSQL Connected: database="${res.rows[0].db_name}", user="${res.rows[0].user_name}"`
    );
    return p;
  } catch (error) {
    console.error(`PostgreSQL connection error: ${error.message}`);
    throw error;
  }
}

async function query(text, params) {
  const p = getPool();
  return p.query(text, params);
}

async function getClient() {
  const p = getPool();
  return p.connect();
}

async function closeDB() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  connectDB,
  query,
  getClient,
  getPool,
  closeDB,
  get pool() {
    return getPool();
  },
};
