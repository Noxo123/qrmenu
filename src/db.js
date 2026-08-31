const Database = require('better-sqlite3');

const db = new Database(process.env.DB_PATH || './database.sqlite');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  subscription_plan TEXT NOT NULL DEFAULT 'free',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS restaurants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '', phone TEXT DEFAULT '', address TEXT DEFAULT '', logo_url TEXT DEFAULT '', theme TEXT DEFAULT 'light', accent_color TEXT DEFAULT '#19a463', order_url TEXT DEFAULT '', instagram TEXT DEFAULT '', opening_hours TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  position INTEGER DEFAULT 0,
  FOREIGN KEY(restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '', price REAL NOT NULL DEFAULT 0, image_url TEXT DEFAULT '', available INTEGER NOT NULL DEFAULT 1, position INTEGER DEFAULT 0, featured INTEGER NOT NULL DEFAULT 0, allergens TEXT DEFAULT '', tags TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT 'Application',
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  last_used_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  FOREIGN KEY(restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS api_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT 'API Token',
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  monthly_limit INTEGER NOT NULL DEFAULT 500,
  request_count INTEGER NOT NULL DEFAULT 0,
  period_start TEXT NOT NULL DEFAULT '',
  last_used_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
`);

const migrations = [
  ['users', 'subscription_plan', "ALTER TABLE users ADD COLUMN subscription_plan TEXT NOT NULL DEFAULT 'free'"],
  ['restaurants', 'accent_color', "ALTER TABLE restaurants ADD COLUMN accent_color TEXT DEFAULT '#19a463'"],
  ['restaurants', 'order_url', "ALTER TABLE restaurants ADD COLUMN order_url TEXT DEFAULT ''"],
  ['restaurants', 'instagram', "ALTER TABLE restaurants ADD COLUMN instagram TEXT DEFAULT ''"],
  ['restaurants', 'opening_hours', "ALTER TABLE restaurants ADD COLUMN opening_hours TEXT DEFAULT ''"],
  ['products', 'featured', 'ALTER TABLE products ADD COLUMN featured INTEGER NOT NULL DEFAULT 0'],
  ['products', 'allergens', "ALTER TABLE products ADD COLUMN allergens TEXT DEFAULT ''"],
  ['products', 'tags', "ALTER TABLE products ADD COLUMN tags TEXT DEFAULT ''"]
];
for (const [table, column, sql] of migrations) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some(c => c.name === column)) db.exec(sql);
}

// Older QRMenu releases had UNIQUE(user_id) on restaurants. API provisioning
// needs multiple restaurants per account, so rebuild the table once without
// that constraint while preserving all existing restaurant IDs and data.
const restaurantSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='restaurants'").get()?.sql || '';
if (/user_id\s+INTEGER\s+NOT\s+NULL\s+UNIQUE/i.test(restaurantSql)) {
  db.pragma('foreign_keys = OFF');
  try {
    db.exec(`
      BEGIN;
      CREATE TABLE restaurants_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        description TEXT DEFAULT '', phone TEXT DEFAULT '', address TEXT DEFAULT '', logo_url TEXT DEFAULT '', theme TEXT DEFAULT 'light', accent_color TEXT DEFAULT '#19a463', order_url TEXT DEFAULT '', instagram TEXT DEFAULT '', opening_hours TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      INSERT INTO restaurants_new(id,user_id,name,slug,description,phone,address,logo_url,theme,accent_color,order_url,instagram,opening_hours,created_at)
        SELECT id,user_id,name,slug,description,phone,address,logo_url,theme,accent_color,order_url,instagram,opening_hours,created_at FROM restaurants;
      DROP TABLE restaurants;
      ALTER TABLE restaurants_new RENAME TO restaurants;
      COMMIT;
    `);
  } catch (error) {
    if (db.inTransaction) db.exec('ROLLBACK');
    throw error;
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

const indexes = [
  'CREATE INDEX IF NOT EXISTS idx_restaurants_user_id ON restaurants(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_categories_restaurant_position ON categories(restaurant_id, position)',
  'CREATE INDEX IF NOT EXISTS idx_products_category_position ON products(category_id, position)',
  'CREATE INDEX IF NOT EXISTS idx_products_category_available ON products(category_id, available)',
  'CREATE INDEX IF NOT EXISTS idx_scans_restaurant_created ON scans(restaurant_id, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_api_keys_restaurant ON api_keys(restaurant_id)',
  'CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash)',
  'CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash)'
];
for (const sql of indexes) db.exec(sql);

module.exports = db;
