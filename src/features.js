const crypto = require('crypto');
const path = require('path');
const QRCode = require('qrcode');
const db = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS qr_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT 'QR Code',
  code TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  last_scanned_at TEXT,
  scan_count INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY(restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_qr_codes_restaurant ON qr_codes(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_qr_codes_code ON qr_codes(code);
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL,
  rating INTEGER NOT NULL,
  comment TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_feedback_restaurant_created ON feedback(restaurant_id, created_at);
`);

function registerFeatures(app, { BASE_URL, requireAuth }) {
  const ownerRestaurant = req => db.prepare('SELECT * FROM restaurants WHERE user_id=? ORDER BY id LIMIT 1').get(req.session.userId);
  const ownedCategory = (req, id) => { const restaurant = ownerRestaurant(req); return restaurant ? db.prepare('SELECT * FROM categories WHERE id=? AND restaurant_id=?').get(id, restaurant.id) : null; };

  app.post('/api/categories/:id/duplicate', requireAuth, (req, res, next) => {
    try {
      const category = ownedCategory(req, req.params.id);
      if (!category) return res.status(404).json({ error: 'Catégorie introuvable.' });
      const restaurant = ownerRestaurant(req);
      const result = db.transaction(() => {
        const position = db.prepare('SELECT COALESCE(MAX(position)+1,0) p FROM categories WHERE restaurant_id=?').get(restaurant.id).p;
        const copy = db.prepare('INSERT INTO categories(restaurant_id,name,position) VALUES(?,?,?)').run(restaurant.id, `${category.name} (copie)`, position);
        const products = db.prepare('SELECT * FROM products WHERE category_id=? ORDER BY position,id').all(category.id);
        const insert = db.prepare('INSERT INTO products(category_id,name,description,price,image_url,available,position,featured,allergens,tags) VALUES(?,?,?,?,?,?,?,?,?,?)');
        for (const p of products) insert.run(copy.lastInsertRowid, p.name, p.description, p.price, p.image_url, p.available, p.position, p.featured, p.allergens, p.tags);
        return Number(copy.lastInsertRowid);
      })();
      res.status(201).json({ id: result });
    } catch (error) { next(error); }
  });

  app.post('/api/categories/reorder', requireAuth, (req, res) => {
    const restaurant = ownerRestaurant(req);
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
    if (!restaurant || !ids.length) return res.status(422).json({ error: 'Liste de catégories invalide.' });
    const owned = db.prepare('SELECT id FROM categories WHERE restaurant_id=?').all(restaurant.id).map(x => x.id);
    if (ids.length !== owned.length || ids.some(id => !owned.includes(id)) || new Set(ids).size !== ids.length) return res.status(422).json({ error: 'Les catégories ne correspondent pas au restaurant.' });
    const update = db.prepare('UPDATE categories SET position=? WHERE id=?');
    db.transaction(() => ids.forEach((id, position) => update.run(position, id)))();
    res.json({ ok: true });
  });

  app.post('/api/products/reorder', requireAuth, (req, res) => {
    const restaurant = ownerRestaurant(req);
    const categoryId = Number(req.body.category_id);
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
    if (!restaurant || !Number.isInteger(categoryId) || !ids.length) return res.status(422).json({ error: 'Réorganisation invalide.' });
    const category = db.prepare('SELECT id FROM categories WHERE id=? AND restaurant_id=?').get(categoryId, restaurant.id);
    const owned = category ? db.prepare('SELECT id FROM products WHERE category_id=?').all(categoryId).map(x => x.id) : [];
    if (!category || ids.length !== owned.length || ids.some(id => !owned.includes(id)) || new Set(ids).size !== ids.length) return res.status(422).json({ error: 'Les produits ne correspondent pas à la catégorie.' });
    const update = db.prepare('UPDATE products SET position=? WHERE id=?');
    db.transaction(() => ids.forEach((id, position) => update.run(position, id)))();
    res.json({ ok: true });
  });

  app.get('/api/menu/export', requireAuth, (req, res) => {
    const restaurant = ownerRestaurant(req);
    if (!restaurant) return res.status(404).json({ error: 'Restaurant introuvable.' });
    const categories = db.prepare('SELECT id,name,position FROM categories WHERE restaurant_id=? ORDER BY position,id').all(restaurant.id);
    const products = db.prepare('SELECT p.id,p.category_id,p.name,p.description,p.price,p.image_url,p.available,p.position,p.featured,p.allergens,p.tags FROM products p JOIN categories c ON c.id=p.category_id WHERE c.restaurant_id=? ORDER BY p.category_id,p.position,p.id').all(restaurant.id);
    const productByCategory = new Map();
    for (const p of products) { if (!productByCategory.has(p.category_id)) productByCategory.set(p.category_id, []); productByCategory.get(p.category_id).push(p); }
    res.json({ version: 1, exported_at: new Date().toISOString(), restaurant: { name: restaurant.name, slug: restaurant.slug, description: restaurant.description, phone: restaurant.phone, address: restaurant.address, logo_url: restaurant.logo_url, theme: restaurant.theme, accent_color: restaurant.accent_color, order_url: restaurant.order_url, instagram: restaurant.instagram, opening_hours: restaurant.opening_hours }, categories: categories.map(c => ({ ...c, products: productByCategory.get(c.id) || [] })) });
  });

  app.post('/api/menu/import', requireAuth, (req, res, next) => {
    try {
      const restaurant = ownerRestaurant(req);
      const payload = req.body?.menu || req.body;
      if (!restaurant || !payload || !Array.isArray(payload.categories)) return res.status(422).json({ error: 'Export QRMenu invalide.' });
      const mode = payload.mode === 'merge' || req.query.mode === 'merge' ? 'merge' : 'replace';
      const result = db.transaction(() => {
        if (mode === 'replace') {
          db.prepare('DELETE FROM products WHERE category_id IN (SELECT id FROM categories WHERE restaurant_id=?)').run(restaurant.id);
          db.prepare('DELETE FROM categories WHERE restaurant_id=?').run(restaurant.id);
        }
        const insertCategory = db.prepare('INSERT INTO categories(restaurant_id,name,position) VALUES(?,?,?)');
        const insertProduct = db.prepare('INSERT INTO products(category_id,name,description,price,image_url,available,position,featured,allergens,tags) VALUES(?,?,?,?,?,?,?,?,?,?)');
        let categoryCount = 0, productCount = 0;
        for (const category of payload.categories) {
          const name = String(category.name || '').trim();
          if (!name) continue;
          const c = insertCategory.run(restaurant.id, name.slice(0, 100), Number.isInteger(category.position) ? category.position : categoryCount);
          categoryCount++;
          for (const product of Array.isArray(category.products) ? category.products : []) {
            const productName = String(product.name || '').trim();
            const price = Number(product.price);
            if (!productName || !Number.isFinite(price) || price < 0) continue;
            insertProduct.run(c.lastInsertRowid, productName.slice(0, 160), String(product.description || '').trim().slice(0, 2000), price, String(product.image_url || '').trim().slice(0, 2000), product.available === false || product.available === 0 ? 0 : 1, Number.isInteger(product.position) ? product.position : productCount, product.featured ? 1 : 0, String(product.allergens || '').trim().slice(0, 1000), String(product.tags || '').trim().slice(0, 1000));
            productCount++;
          }
        }
        return { categoryCount, productCount };
      })();
      res.json({ ok: true, mode, ...result });
    } catch (error) { next(error); }
  });

  app.get('/api/qr-codes', requireAuth, (req, res) => {
    const restaurant = ownerRestaurant(req);
    if (!restaurant) return res.status(404).json({ error: 'Restaurant introuvable.' });
    res.json(db.prepare('SELECT id,name,code,created_at,last_scanned_at,scan_count,active FROM qr_codes WHERE restaurant_id=? ORDER BY id DESC').all(restaurant.id));
  });

  app.post('/api/qr-codes', requireAuth, (req, res) => {
    const restaurant = ownerRestaurant(req);
    if (!restaurant) return res.status(404).json({ error: 'Restaurant introuvable.' });
    const name = String(req.body.name || 'Nouveau QR').trim().slice(0, 80) || 'Nouveau QR';
    const code = `q_${crypto.randomBytes(8).toString('hex')}`;
    const x = db.prepare('INSERT INTO qr_codes(restaurant_id,name,code) VALUES(?,?,?)').run(restaurant.id, name, code);
    res.status(201).json({ id: Number(x.lastInsertRowid), name, code, url: `${BASE_URL}/q/${code}` });
  });

  app.patch('/api/qr-codes/:id', requireAuth, (req, res) => {
    const restaurant = ownerRestaurant(req);
    const qr = restaurant ? db.prepare('SELECT * FROM qr_codes WHERE id=? AND restaurant_id=?').get(req.params.id, restaurant.id) : null;
    if (!qr) return res.status(404).json({ error: 'QR code introuvable.' });
    const fields = [], values = [];
    if (req.body.name !== undefined) { const name = String(req.body.name).trim(); if (!name) return res.status(422).json({ error: 'Nom requis.' }); fields.push('name=?'); values.push(name.slice(0, 80)); }
    if (req.body.active !== undefined) { fields.push('active=?'); values.push(req.body.active ? 1 : 0); }
    if (!fields.length) return res.json({ ok: true });
    db.prepare(`UPDATE qr_codes SET ${fields.join(',')} WHERE id=?`).run(...values, qr.id);
    res.json({ ok: true });
  });

  app.delete('/api/qr-codes/:id', requireAuth, (req, res) => {
    const restaurant = ownerRestaurant(req);
    const qr = restaurant ? db.prepare('SELECT id FROM qr_codes WHERE id=? AND restaurant_id=?').get(req.params.id, restaurant.id) : null;
    if (!qr) return res.status(404).json({ error: 'QR code introuvable.' });
    db.prepare('DELETE FROM qr_codes WHERE id=?').run(qr.id);
    res.json({ ok: true });
  });

  app.get('/api/qr-codes/:id/image', requireAuth, async (req, res, next) => {
    try {
      const restaurant = ownerRestaurant(req);
      const qr = restaurant ? db.prepare('SELECT * FROM qr_codes WHERE id=? AND restaurant_id=?').get(req.params.id, restaurant.id) : null;
      if (!qr) return res.status(404).json({ error: 'QR code introuvable.' });
      const url = `${BASE_URL}/q/${qr.code}`;
      if (String(req.query.format || 'png').toLowerCase() === 'svg') return res.type('image/svg+xml').send(await QRCode.toString(url, { type: 'svg', width: 900, margin: 2 }));
      res.type('png').send(await QRCode.toBuffer(url, { width: 900, margin: 2, type: 'png' }));
    } catch (error) { next(error); }
  });

  app.get('/feedback/:slug', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'feedback.html')));

  app.post('/api/public/feedback/:slug', (req, res) => {
    const restaurant = db.prepare('SELECT id FROM restaurants WHERE slug=?').get(req.params.slug);
    if (!restaurant) return res.status(404).json({ error: 'Restaurant introuvable.' });
    const rating = Number(req.body.rating);
    const comment = String(req.body.comment || '').trim().slice(0, 1000);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(422).json({ error: 'La note doit être comprise entre 1 et 5.' });
    db.prepare('INSERT INTO feedback(restaurant_id,rating,comment) VALUES(?,?,?)').run(restaurant.id, rating, comment);
    res.status(201).json({ ok: true });
  });

  app.get('/api/feedback', requireAuth, (req, res) => {
    const restaurant = ownerRestaurant(req);
    if (!restaurant) return res.status(404).json({ error: 'Restaurant introuvable.' });
    const summary = db.prepare('SELECT COUNT(*) count,COALESCE(ROUND(AVG(rating),2),0) average FROM feedback WHERE restaurant_id=?').get(restaurant.id);
    const distribution = db.prepare('SELECT rating,COUNT(*) count FROM feedback WHERE restaurant_id=? GROUP BY rating ORDER BY rating DESC').all(restaurant.id);
    const recent = db.prepare('SELECT id,rating,comment,created_at FROM feedback WHERE restaurant_id=? ORDER BY id DESC LIMIT 50').all(restaurant.id);
    res.json({ summary, distribution, recent });
  });

  app.get('/api/insights', requireAuth, (req, res) => {
    const restaurant = ownerRestaurant(req);
    if (!restaurant) return res.status(404).json({ error: 'Restaurant introuvable.' });
    const scansByHour = db.prepare("SELECT CAST(strftime('%H',created_at) AS INTEGER) hour,COUNT(*) count FROM scans WHERE restaurant_id=? GROUP BY hour ORDER BY hour").all(restaurant.id);
    const featuredProducts = db.prepare('SELECT p.id,p.name,p.price,p.image_url,p.featured FROM products p JOIN categories c ON c.id=p.category_id WHERE c.restaurant_id=? AND p.available=1 ORDER BY p.featured DESC,p.position,p.id LIMIT 10').all(restaurant.id);
    const feedback = db.prepare('SELECT COUNT(*) count,COALESCE(ROUND(AVG(rating),2),0) average FROM feedback WHERE restaurant_id=?').get(restaurant.id);
    const days = db.prepare("SELECT date(created_at) day,COUNT(*) count FROM scans WHERE restaurant_id=? AND created_at>=datetime('now','-30 day') GROUP BY date(created_at) ORDER BY day").all(restaurant.id);
    res.json({ scans_by_hour: scansByHour, featured_products: featuredProducts, feedback, days });
  });

  app.get('/manifest.webmanifest', (req, res) => res.type('application/manifest+json').send(JSON.stringify({ name: 'QRMenu', short_name: 'QRMenu', start_url: '/', display: 'standalone', background_color: '#ffffff', theme_color: '#19a463', icons: [] })));
  app.get('/sw.js', (req, res) => res.type('application/javascript').send(`const CACHE='qrmenu-v1';self.addEventListener('install',e=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;const u=new URL(e.request.url);if(u.pathname.startsWith('/api/'))return;e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request).then(r=>{const x=r.clone();caches.open(CACHE).then(cache=>cache.put(e.request,x));return r}).catch(()=>c)))})`));
}

module.exports = { registerFeatures };
