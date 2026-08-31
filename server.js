const express = require('express');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const cors = require('cors');
const { rateLimit } = require('express-rate-limit');
const db = require('./src/db');
const { buildOpenApi } = require('./src/openapi');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

app.disable('x-powered-by');
app.set('trust proxy', IS_PRODUCTION ? 1 : false);
app.use(helmet({ contentSecurityPolicy: false }));

const allowedOrigins = String(process.env.CORS_ORIGIN || BASE_URL).split(',').map(v => v.trim()).filter(Boolean);
app.use(cors({ origin(origin, callback) {
  if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return callback(null, true);
  return callback(new Error('CORS origin not allowed'));
}, credentials: true }));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'qrmenu-dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PRODUCTION,
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));
app.use('/assets', express.static(path.join(__dirname, 'public'), { maxAge: IS_PRODUCTION ? '1d' : 0 }));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: Number(process.env.LOGIN_RATE_LIMIT) || 10, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Trop de tentatives. Réessayez plus tard.' } });
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: Number(process.env.REGISTER_RATE_LIMIT) || 5, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Trop de créations de comptes. Réessayez plus tard.' } });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, limit: Number(process.env.API_RATE_LIMIT) || 100, standardHeaders: 'draft-8', legacyHeaders: false, handler: (req, res) => res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message: 'Trop de requêtes. Réessayez dans un instant.' } }) });

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

function jsonError(res, status, code, message, details) {
  const body = { success: false, error: { code, message } };
  if (details) body.error.details = details;
  return res.status(status).json(body);
}

function slugify(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

function myRestaurant(req) {
  return db.prepare('SELECT * FROM restaurants WHERE user_id=?').get(req.session.userId);
}

function ownedCategory(req, id) {
  const r = myRestaurant(req);
  return r ? db.prepare('SELECT * FROM categories WHERE id=? AND restaurant_id=?').get(id, r.id) : null;
}

function ownedProduct(req, id) {
  const r = myRestaurant(req);
  return r ? db.prepare('SELECT p.* FROM products p JOIN categories c ON c.id=p.category_id WHERE p.id=? AND c.restaurant_id=?').get(id, r.id) : null;
}

function publicMenu(slug) {
  const restaurant = db.prepare('SELECT id,name,slug,description,phone,address,logo_url,theme,accent_color,order_url,instagram,opening_hours FROM restaurants WHERE slug=?').get(slug);
  if (!restaurant) return null;
  const categories = db.prepare('SELECT id,name,position FROM categories WHERE restaurant_id=? ORDER BY position,id').all(restaurant.id);
  const productQuery = db.prepare('SELECT id,name,description,price,image_url,featured,allergens,tags,available,position FROM products WHERE category_id=? AND available=1 ORDER BY featured DESC,position,id');
  categories.forEach(category => { category.products = productQuery.all(category.id); });
  return { restaurant, categories };
}

function normalizeBoolean(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return 1;
  if (value === false || value === 0 || value === '0' || value === 'false') return 0;
  return value;
}

function normalizeProductField(key, value) {
  if (['available', 'featured'].includes(key)) return normalizeBoolean(value);
  if (key === 'price') return Number(value);
  if (['name', 'description', 'image_url', 'allergens', 'tags'].includes(key)) return String(value ?? '').trim();
  return value;
}

// Web pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'landing.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));
app.get('/dashboard', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/dashboard/menu', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'menu-editor.html')));
app.get('/dashboard/products', requireAuth, (req, res) => res.redirect('/dashboard/menu'));
app.get('/dashboard/qr', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'qr.html')));
app.get('/dashboard/settings', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'settings.html')));
app.get('/dashboard/developer', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'developer.html')));
app.get('/api-docs', (req, res) => res.sendFile(path.join(__dirname, 'public', 'api-docs.html')));
app.get('/api-docs/openapi.json', (req, res) => res.json(buildOpenApi(BASE_URL)));

// Authentication
app.post('/api/auth/register', registerLimiter, async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const restaurantName = String(req.body.restaurant || '').trim();
    if (!name || !email || !password || !restaurantName || password.length < 8) return res.status(400).json({ error: 'Informations invalides. Mot de passe : 8 caractères minimum.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Adresse email invalide.' });
    if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) return res.status(409).json({ error: 'Cet email est déjà utilisé.' });
    const create = db.transaction(() => {
      const user = db.prepare('INSERT INTO users(name,email,password_hash) VALUES(?,?,?)').run(name, email, bcrypt.hashSync(password, 12));
      const base = slugify(restaurantName) || 'restaurant';
      let slug = base; let i = 1;
      while (db.prepare('SELECT id FROM restaurants WHERE slug=?').get(slug)) slug = `${base}-${i++}`;
      const restaurant = db.prepare('INSERT INTO restaurants(user_id,name,slug) VALUES(?,?,?)').run(user.lastInsertRowid, restaurantName, slug);
      db.prepare('INSERT INTO categories(restaurant_id,name,position) VALUES(?,?,0)').run(restaurant.lastInsertRowid, 'Nos produits');
      return Number(user.lastInsertRowid);
    });
    req.session.userId = create();
    res.json({ ok: true, redirect: '/dashboard' });
  } catch (error) { next(error); }
});

app.post('/api/auth/login', loginLimiter, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
    req.session.regenerate(err => {
      if (err) return next(err);
      req.session.userId = user.id;
      res.json({ ok: true, redirect: '/dashboard' });
    });
  } catch (error) { next(error); }
});
app.post('/api/auth/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

// Dashboard API
app.get('/api/me', requireAuth, (req, res) => {
  const restaurant = myRestaurant(req);
  res.json({ user: db.prepare('SELECT id,name,email,created_at FROM users WHERE id=?').get(req.session.userId), restaurant });
});

app.get('/api/menu', requireAuth, (req, res) => {
  const restaurant = myRestaurant(req);
  if (!restaurant) return res.status(404).json({ error: 'Restaurant introuvable.' });
  const categories = db.prepare('SELECT * FROM categories WHERE restaurant_id=? ORDER BY position,id').all(restaurant.id);
  const products = db.prepare('SELECT * FROM products WHERE category_id=? ORDER BY position,id');
  categories.forEach(category => { category.products = products.all(category.id); });
  res.json(categories);
});

app.post('/api/categories', requireAuth, (req, res) => {
  const restaurant = myRestaurant(req);
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Nom requis' });
  if (name.length > 100) return res.status(422).json({ error: 'Nom trop long.' });
  const x = db.prepare('INSERT INTO categories(restaurant_id,name,position) VALUES(?,?,COALESCE((SELECT MAX(position)+1 FROM categories WHERE restaurant_id=?),0))').run(restaurant.id, name, restaurant.id);
  res.status(201).json({ id: Number(x.lastInsertRowid), name });
});

app.patch('/api/categories/:id', requireAuth, (req, res) => {
  const category = ownedCategory(req, req.params.id);
  const name = String(req.body.name || '').trim();
  if (!category) return res.status(404).json({ error: 'Catégorie introuvable' });
  if (!name) return res.status(400).json({ error: 'Nom requis' });
  db.prepare('UPDATE categories SET name=? WHERE id=?').run(name, category.id);
  res.json({ ok: true });
});

app.delete('/api/categories/:id', requireAuth, (req, res) => {
  const category = ownedCategory(req, req.params.id);
  if (!category) return res.status(404).json({ error: 'Catégorie introuvable' });
  db.prepare('DELETE FROM categories WHERE id=?').run(category.id);
  res.json({ ok: true });
});

app.post('/api/products', requireAuth, (req, res) => {
  const restaurant = myRestaurant(req);
  const categoryId = Number(req.body.category_id);
  const category = db.prepare('SELECT id FROM categories WHERE id=? AND restaurant_id=?').get(categoryId, restaurant.id);
  const name = String(req.body.name || '').trim();
  const price = Number(req.body.price);
  if (!category) return res.status(404).json({ error: 'Catégorie introuvable' });
  if (!name) return res.status(422).json({ error: 'Nom requis.' });
  if (!Number.isFinite(price) || price < 0) return res.status(422).json({ error: 'Prix invalide.' });
  const position = db.prepare('SELECT COALESCE(MAX(position)+1,0) p FROM products WHERE category_id=?').get(category.id).p;
  const x = db.prepare('INSERT INTO products(category_id,name,description,price,image_url,available,position,featured,allergens,tags) VALUES(?,?,?,?,?,?,?,?,?,?)').run(category.id, name, String(req.body.description || '').trim(), price, String(req.body.image_url || '').trim(), normalizeBoolean(req.body.available ?? true), position, normalizeBoolean(req.body.featured ?? false), String(req.body.allergens || '').trim(), String(req.body.tags || '').trim());
  res.status(201).json({ id: Number(x.lastInsertRowid) });
});

app.patch('/api/products/:id', requireAuth, (req, res) => {
  const product = ownedProduct(req, req.params.id);
  if (!product) return res.status(404).json({ error: 'Produit introuvable' });
  const allowed = ['name', 'description', 'price', 'image_url', 'available', 'featured', 'allergens', 'tags', 'category_id', 'position'];
  const fields = allowed.filter(key => req.body[key] !== undefined);
  if (!fields.length) return res.json({ ok: true });
  if (req.body.category_id !== undefined) {
    const restaurant = myRestaurant(req);
    const category = db.prepare('SELECT id FROM categories WHERE id=? AND restaurant_id=?').get(Number(req.body.category_id), restaurant.id);
    if (!category) return res.status(422).json({ error: 'Catégorie invalide.' });
  }
  if (req.body.price !== undefined && (!Number.isFinite(Number(req.body.price)) || Number(req.body.price) < 0)) return res.status(422).json({ error: 'Prix invalide.' });
  if (req.body.name !== undefined && !String(req.body.name).trim()) return res.status(422).json({ error: 'Nom requis.' });
  const values = fields.map(key => normalizeProductField(key, req.body[key]));
  db.prepare(`UPDATE products SET ${fields.map(key => `${key}=?`).join(',')} WHERE id=?`).run(...values, product.id);
  res.json({ ok: true });
});

app.post('/api/products/:id/duplicate', requireAuth, (req, res) => {
  const product = ownedProduct(req, req.params.id);
  if (!product) return res.status(404).json({ error: 'Produit introuvable' });
  const position = Number(db.prepare('SELECT COALESCE(MAX(position)+1,0) p FROM products WHERE category_id=?').get(product.category_id).p);
  const x = db.prepare('INSERT INTO products(category_id,name,description,price,image_url,available,position,featured,allergens,tags) VALUES(?,?,?,?,?,?,?,?,?,?)').run(product.category_id, `${product.name} (copie)`, product.description, product.price, product.image_url, product.available, position, product.featured, product.allergens, product.tags);
  res.status(201).json({ id: Number(x.lastInsertRowid) });
});

app.delete('/api/products/:id', requireAuth, (req, res) => {
  const product = ownedProduct(req, req.params.id);
  if (!product) return res.status(404).json({ error: 'Produit introuvable' });
  db.prepare('DELETE FROM products WHERE id=?').run(product.id);
  res.json({ ok: true });
});

app.patch('/api/restaurant', requireAuth, (req, res) => {
  const restaurant = myRestaurant(req);
  const fields = ['name', 'description', 'phone', 'address', 'logo_url', 'theme', 'accent_color', 'order_url', 'instagram', 'opening_hours'];
  const used = fields.filter(key => req.body[key] !== undefined);
  if (req.body.name !== undefined && !String(req.body.name).trim()) return res.status(422).json({ error: 'Le nom est requis.' });
  if (used.length) db.prepare(`UPDATE restaurants SET ${used.map(key => `${key}=?`).join(',')} WHERE id=?`).run(...used.map(key => String(req.body[key] ?? '').trim()), restaurant.id);
  res.json({ ok: true });
});

app.get('/api/qr', requireAuth, async (req, res, next) => {
  try {
    const restaurant = myRestaurant(req);
    const target = `${BASE_URL}/m/${restaurant.slug}`;
    const data = await QRCode.toDataURL(target, { width: 800, margin: 2 });
    const svg = await QRCode.toString(target, { type: 'svg', width: 800, margin: 2 });
    res.json({ target, data, svg });
  } catch (error) { next(error); }
});
app.get('/q/:code', (req, res) => res.redirect(`/m/${encodeURIComponent(req.params.code)}`));

app.get('/api/stats', requireAuth, (req, res) => {
  const restaurant = myRestaurant(req);
  const scans30 = db.prepare("SELECT COUNT(*) count FROM scans WHERE restaurant_id=? AND created_at>=datetime('now','-30 day')").get(restaurant.id).count;
  const scans7 = db.prepare("SELECT COUNT(*) count FROM scans WHERE restaurant_id=? AND created_at>=datetime('now','-7 day')").get(restaurant.id).count;
  const products = db.prepare('SELECT COUNT(*) count FROM products p JOIN categories c ON c.id=p.category_id WHERE c.restaurant_id=?').get(restaurant.id).count;
  const available = db.prepare('SELECT COUNT(*) count FROM products p JOIN categories c ON c.id=p.category_id WHERE c.restaurant_id=? AND p.available=1').get(restaurant.id).count;
  const categories = db.prepare('SELECT COUNT(*) count FROM categories WHERE restaurant_id=?').get(restaurant.id).count;
  const daily = db.prepare("SELECT date(created_at) day,COUNT(*) count FROM scans WHERE restaurant_id=? AND created_at>=datetime('now','-30 day') GROUP BY date(created_at) ORDER BY day").all(restaurant.id);
  res.json({ scans: scans30, scans7, products, available, categories, daily });
});

// Public menu
app.get('/m/:slug', (req, res) => {
  const restaurant = db.prepare('SELECT id FROM restaurants WHERE slug=?').get(req.params.slug);
  if (!restaurant) return res.status(404).send('Restaurant introuvable');
  db.prepare('INSERT INTO scans(restaurant_id) VALUES(?)').run(restaurant.id);
  res.sendFile(path.join(__dirname, 'public', 'menu-public.html'));
});
app.get('/api/public/menu/:slug', (req, res) => {
  const data = publicMenu(req.params.slug);
  if (!data) return res.status(404).json({ error: 'Introuvable' });
  res.json(data);
});

// API v1
app.use('/api/v1', apiLimiter);
app.get('/api/v1/health', (req, res) => res.json({ success: true, data: { status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() } }));

function apiKeyAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const key = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!key) return jsonError(res, 401, 'AUTH_REQUIRED', 'Authorization: Bearer <API_KEY> est requis.');
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  const record = db.prepare('SELECT * FROM api_keys WHERE key_hash=? AND revoked_at IS NULL').get(hash);
  if (!record) return jsonError(res, 401, 'INVALID_API_KEY', 'Clé API invalide ou révoquée.');
  db.prepare('UPDATE api_keys SET last_used_at=CURRENT_TIMESTAMP WHERE id=?').run(record.id);
  req.apiKey = record;
  next();
}

function apiWrap(data) { return { success: true, data }; }
function loadApiMenu(req, res) {
  const data = publicMenu(req.params.slug);
  if (!data) { jsonError(res, 404, 'NOT_FOUND', 'Restaurant introuvable.'); return null; }
  if (data.restaurant.id !== req.apiKey.restaurant_id) { jsonError(res, 403, 'FORBIDDEN', 'Cette clé ne peut pas accéder à ce restaurant.'); return null; }
  return data;
}

app.use('/api/v1', apiKeyAuth);
app.get('/api/v1/menu/:slug', (req, res) => { const data = loadApiMenu(req, res); if (data) res.json(apiWrap(data)); });
app.get('/api/v1/restaurants/:slug', (req, res) => { const data = loadApiMenu(req, res); if (data) res.json(apiWrap(data.restaurant)); });
app.get('/api/v1/categories/:slug', (req, res) => { const data = loadApiMenu(req, res); if (data) res.json(apiWrap(data.categories)); });
app.get('/api/v1/products/:slug', (req, res) => {
  const data = loadApiMenu(req, res);
  if (!data) return;
  const products = data.categories.flatMap(category => category.products.map(product => ({ ...product, category_id: category.id, category_name: category.name })));
  res.json(apiWrap(products));
});
app.get('/api/v1/products/:slug/:id', (req, res) => {
  const data = loadApiMenu(req, res);
  if (!data) return;
  const product = data.categories.flatMap(category => category.products.map(p => ({ ...p, category_id: category.id, category_name: category.name }))).find(p => String(p.id) === String(req.params.id));
  if (!product) return jsonError(res, 404, 'PRODUCT_NOT_FOUND', 'Produit introuvable.');
  res.json(apiWrap(product));
});
app.get('/api/v1/search/:slug', (req, res) => {
  const data = loadApiMenu(req, res);
  if (!data) return;
  const query = String(req.query.q || '').trim().toLowerCase();
  if (!query) return jsonError(res, 400, 'QUERY_REQUIRED', 'Le paramètre q est requis.');
  const products = data.categories.flatMap(category => category.products.map(p => ({ ...p, category_id: category.id, category_name: category.name }))).filter(product => `${product.name} ${product.description || ''} ${product.tags || ''}`.toLowerCase().includes(query));
  res.json(apiWrap({ query, count: products.length, products }));
});

// API key management
app.get('/api/developer/keys', requireAuth, (req, res) => {
  const restaurant = myRestaurant(req);
  res.json(db.prepare('SELECT id,name,key_prefix,last_used_at,created_at,revoked_at FROM api_keys WHERE restaurant_id=? ORDER BY id DESC').all(restaurant.id));
});
app.post('/api/developer/keys', requireAuth, (req, res) => {
  const restaurant = myRestaurant(req);
  const name = String(req.body.name || 'Application').trim().slice(0, 80) || 'Application';
  const raw = `qm_live_${crypto.randomBytes(24).toString('hex')}`;
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const prefix = raw.slice(0, 16);
  const x = db.prepare('INSERT INTO api_keys(restaurant_id,name,key_hash,key_prefix) VALUES(?,?,?,?)').run(restaurant.id, name, hash, prefix);
  res.status(201).json({ id: Number(x.lastInsertRowid), name, key: raw, key_prefix: prefix, warning: 'Cette clé ne sera plus affichée. Copiez-la maintenant.' });
});
app.delete('/api/developer/keys/:id', requireAuth, (req, res) => {
  const restaurant = myRestaurant(req);
  const key = db.prepare('SELECT id FROM api_keys WHERE id=? AND restaurant_id=?').get(req.params.id, restaurant.id);
  if (!key) return res.status(404).json({ error: 'Clé introuvable.' });
  db.prepare("UPDATE api_keys SET revoked_at=CURRENT_TIMESTAMP WHERE id=?").run(key.id);
  res.json({ ok: true });
});

// API-friendly 404
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return jsonError(res, 404, 'NOT_FOUND', 'Route API introuvable.');
  const error = new Error('Page introuvable'); error.status = 404; next(error);
});

app.use((error, req, res, next) => {
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, error);
  if (res.headersSent) return next(error);
  if (req.path.startsWith('/api/')) return jsonError(res, error.status || 500, 'INTERNAL_ERROR', IS_PRODUCTION ? 'Une erreur interne est survenue.' : error.message);
  res.status(error.status || 500).send(IS_PRODUCTION ? 'Une erreur est survenue.' : `<h1>Erreur ${error.status || 500}</h1><p>${String(error.message || 'Erreur interne')}</p>`);
});

app.listen(PORT, () => console.log(`QRMenu running on ${BASE_URL}`));
