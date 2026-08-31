const express = require('express');
const session = require('express-session');
const path = require('path');
const QRCode = require('qrcode');
const bcrypt = require('bcryptjs');
const db = require('./src/db');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

app.set('view engine', 'html');
app.engine('html', require('fs').existsSync(path.join(__dirname, 'views')) ? (file, options, cb) => require('fs').readFile(file, 'utf8', (err, str) => cb(err, str.replace(/{{BASE_URL}}/g, BASE_URL))) : undefined);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: process.env.SESSION_SECRET || 'qrmenu-dev-secret-change-me', resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: 'lax' } }));
app.use('/assets', express.static(path.join(__dirname, 'public')));

function requireAuth(req, res, next) { if (!req.session.userId) return res.redirect('/login'); next(); }
function slugify(s) { return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60); }

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'landing.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, restaurant } = req.body;
  if (!name || !email || !password || !restaurant || password.length < 8) return res.status(400).json({ error: 'Informations invalides. Mot de passe: 8 caractères minimum.' });
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (exists) return res.status(409).json({ error: 'Cet email est déjà utilisé.' });
  const user = db.prepare('INSERT INTO users (name,email,password_hash) VALUES (?,?,?)').run(name, email.toLowerCase(), await bcrypt.hash(password, 12));
  let slug = slugify(restaurant) || 'restaurant';
  let i = 1; while (db.prepare('SELECT id FROM restaurants WHERE slug = ?').get(slug)) slug = `${slugify(restaurant)}-${i++}`;
  const r = db.prepare('INSERT INTO restaurants (user_id,name,slug) VALUES (?,?,?)').run(user.lastInsertRowid, restaurant, slug);
  db.prepare('INSERT INTO categories (restaurant_id,name,position) VALUES (?,?,?)').run(r.lastInsertRowid, 'Nos produits', 0);
  req.session.userId = Number(user.lastInsertRowid);
  res.json({ ok: true, redirect: '/dashboard' });
});

app.post('/api/auth/login', async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get((req.body.email || '').toLowerCase());
  if (!user || !(await bcrypt.compare(req.body.password || '', user.password_hash))) return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
  req.session.userId = user.id; res.json({ ok: true, redirect: '/dashboard' });
});
app.post('/api/auth/logout', (req,res) => req.session.destroy(() => res.redirect('/')));

app.get('/dashboard', requireAuth, (req,res) => res.sendFile(path.join(__dirname,'public','dashboard.html')));
app.get('/dashboard/menu', requireAuth, (req,res) => res.sendFile(path.join(__dirname,'public','menu-editor.html')));
app.get('/dashboard/products', requireAuth, (req,res) => res.redirect('/dashboard/menu'));
app.get('/dashboard/qr', requireAuth, (req,res) => res.sendFile(path.join(__dirname,'public','qr.html')));
app.get('/dashboard/settings', requireAuth, (req,res) => res.sendFile(path.join(__dirname,'public','settings.html')));

function myRestaurant(req) { return db.prepare('SELECT * FROM restaurants WHERE user_id = ?').get(req.session.userId); }
app.get('/api/me', requireAuth, (req,res) => { const r=myRestaurant(req); res.json({ user: db.prepare('SELECT id,name,email FROM users WHERE id=?').get(req.session.userId), restaurant:r }); });
app.get('/api/menu', requireAuth, (req,res) => { const r=myRestaurant(req); const cats=db.prepare('SELECT * FROM categories WHERE restaurant_id=? ORDER BY position,id').all(r.id); cats.forEach(c=>c.products=db.prepare('SELECT * FROM products WHERE category_id=? ORDER BY position,id').all(c.id)); res.json(cats); });
app.post('/api/categories', requireAuth, (req,res)=>{ const r=myRestaurant(req); const name=(req.body.name||'').trim(); if(!name)return res.status(400).json({error:'Nom requis'}); const x=db.prepare('INSERT INTO categories(restaurant_id,name,position) VALUES(?,?,COALESCE((SELECT MAX(position)+1 FROM categories WHERE restaurant_id=?),0))').run(r.id,name,r.id); res.json({id:x.lastInsertRowid,name}); });
app.post('/api/products', requireAuth, (req,res)=>{ const r=myRestaurant(req); const cat=db.prepare('SELECT c.* FROM categories c WHERE c.id=? AND c.restaurant_id=?').get(req.body.category_id,r.id); if(!cat)return res.status(404).json({error:'Catégorie introuvable'}); const {name,description,price,image_url}=req.body; if(!name||price===undefined)return res.status(400).json({error:'Nom et prix requis'}); const x=db.prepare('INSERT INTO products(category_id,name,description,price,image_url) VALUES(?,?,?,?,?)').run(cat.id,name,description||'',Number(price),image_url||''); res.json({id:x.lastInsertRowid}); });
app.patch('/api/products/:id', requireAuth, (req,res)=>{ const r=myRestaurant(req); const p=db.prepare('SELECT p.id FROM products p JOIN categories c ON c.id=p.category_id WHERE p.id=? AND c.restaurant_id=?').get(req.params.id,r.id); if(!p)return res.status(404).json({error:'Produit introuvable'}); const allowed=['name','description','price','image_url','available']; const fields=allowed.filter(k=>req.body[k]!==undefined); if(!fields.length)return res.json({ok:true}); const sql=`UPDATE products SET ${fields.map(k=>`${k}=?`).join(',')} WHERE id=?`; db.prepare(sql).run(...fields.map(k=>req.body[k]),p.id); res.json({ok:true}); });
app.delete('/api/products/:id', requireAuth, (req,res)=>{ const r=myRestaurant(req); db.prepare('DELETE FROM products WHERE id IN (SELECT p.id FROM products p JOIN categories c ON c.id=p.category_id WHERE p.id=? AND c.restaurant_id=?)').run(req.params.id,r.id); res.json({ok:true}); });
app.patch('/api/restaurant', requireAuth, (req,res)=>{ const r=myRestaurant(req); const fields=['name','description','phone','address','logo_url','theme']; const used=fields.filter(k=>req.body[k]!==undefined); if(used.length) db.prepare(`UPDATE restaurants SET ${used.map(k=>`${k}=?`).join(',')} WHERE id=?`).run(...used.map(k=>req.body[k]),r.id); res.json({ok:true}); });

app.get('/api/qr', requireAuth, async (req,res)=>{ const r=myRestaurant(req); const target=`${BASE_URL}/m/${r.slug}`; const data=await QRCode.toDataURL(target,{width:600,margin:2}); res.json({target,data}); });
app.get('/q/:code', (req,res)=>res.redirect('/m/'+req.params.code));
app.get('/m/:slug', (req,res)=>{ const r=db.prepare('SELECT * FROM restaurants WHERE slug=?').get(req.params.slug); if(!r)return res.status(404).send('Restaurant introuvable'); db.prepare('INSERT INTO scans(restaurant_id) VALUES(?)').run(r.id); const cats=db.prepare('SELECT * FROM categories WHERE restaurant_id=? ORDER BY position,id').all(r.id); cats.forEach(c=>c.products=db.prepare('SELECT * FROM products WHERE category_id=? AND available=1 ORDER BY position,id').all(c.id)); res.sendFile(path.join(__dirname,'public','menu-public.html')); });
app.get('/api/public/menu/:slug',(req,res)=>{ const r=db.prepare('SELECT id,name,description,phone,address,logo_url,theme FROM restaurants WHERE slug=?').get(req.params.slug); if(!r)return res.status(404).json({error:'Introuvable'}); const cats=db.prepare('SELECT * FROM categories WHERE restaurant_id=? ORDER BY position,id').all(r.id); cats.forEach(c=>c.products=db.prepare('SELECT id,name,description,price,image_url FROM products WHERE category_id=? AND available=1 ORDER BY position,id').all(c.id)); res.json({restaurant:r,categories:cats}); });
app.get('/api/stats', requireAuth,(req,res)=>{ const r=myRestaurant(req); const scans=db.prepare("SELECT COUNT(*) count FROM scans WHERE restaurant_id=? AND created_at >= datetime('now','-30 day')").get(r.id).count; const products=db.prepare('SELECT COUNT(*) count FROM products p JOIN categories c ON c.id=p.category_id WHERE c.restaurant_id=?').get(r.id).count; res.json({scans,products}); });

app.listen(PORT,()=>console.log(`QRMenu running on ${BASE_URL}`));