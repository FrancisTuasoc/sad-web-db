const fs = require('fs');
const path = require('path');
const { getClient, closeDB } = require('../config/db');

const MIGRATIONS = [
  '20261011_email_verification.sql',
  '20261011_store_location.sql',
  '20261011_store_location_highway.sql',
  '20261012_password_reset.sql',
  '20261012_order_checkout.sql',
  '20261015_notifications.sql',
];

async function runMigrations() {
  const client = await getClient();

  try {
    await client.query('BEGIN');
    await client.query('CREATE SCHEMA IF NOT EXISTS app');
    await client.query(`
      CREATE TABLE IF NOT EXISTS app.schema_migrations (
        name VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('app-schema-migrations'))"
    );

    for (const name of MIGRATIONS) {
      const applied = await client.query(
        'SELECT 1 FROM app.schema_migrations WHERE name = $1',
        [name]
      );
      if (applied.rowCount > 0) continue;

      const migrationPath = path.join(__dirname, 'migrations', name);
      const sql = fs.readFileSync(migrationPath, 'utf8');
      await client.query(sql);
      await client.query(
        'INSERT INTO app.schema_migrations (name) VALUES ($1)',
        [name]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log('[MIGRATION] Database migrations are current.');
    })
    .catch((error) => {
      console.error('[MIGRATION ERROR]', error.message);
      process.exitCode = 1;
    })
    .finally(closeDB);
}

module.exports = { runMigrations };
