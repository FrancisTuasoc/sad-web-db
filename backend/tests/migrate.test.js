const assert = require('node:assert/strict');
const { test } = require('node:test');

const { ensureBaseSchema } = require('../src/db/migrate');

test('base schema is initialized when app.users is missing', async () => {
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(sql);
      if (queries.length === 1) return { rows: [{ users_table: null }] };
      return { rows: [] };
    },
  };

  const initialized = await ensureBaseSchema(client);

  assert.equal(initialized, true);
  assert.equal(queries.length, 2);
  assert.match(queries[1], /CREATE TABLE IF NOT EXISTS users/);
});

test('existing app.users table is left untouched', async () => {
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(sql);
      return { rows: [{ users_table: 'app.users' }] };
    },
  };

  const initialized = await ensureBaseSchema(client);

  assert.equal(initialized, false);
  assert.equal(queries.length, 1);
});
