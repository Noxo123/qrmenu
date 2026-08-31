const express = require('express');
const session = require('express-session');
const path = require('path');
const QRCode = require('qrcode');
const bcrypt = require('bcryptjs');
const db = require('./src/db');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: process.env.SESSION_SECRET || 'qrmenu-dev-secret-change-me', resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: 'lax' } }));
app.use('/assets', express.static(path.join(__dirname, 'public')));

function requireAuth(req, res, next) { if (!req.session.userId) return res.redirect('/login'); next(); }
function slugify(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60); }
function myRestaurant(req) { return db.prepare('SELECT * FROM restaurants WHERE user_id = ?').get(req.session.userId); }
function ownedProduct(req, id) { const r = myRestaurant(req); return db.prepare('SELECT p.* FROM products p JOIN categories c ON c.id=p.category_id WHERE p.id=? AND c.restaurant_id=?').get(id, r.id); }

app.get('/', (req,res) => res.sendFile(path.join(__dirname,'public','landing.html')));
app.get('/login', (req,res) => res.sendFile(path.join(__dirname,'public','login.html')));
app.get('/register', (req,res) => res.sendFile(path.join(__dirname,'public','register.html')));
app.get('/dashboard', requireAuth, (req,res) => res.sendFile(path.join(__dirname,'public','dashboard.html')));
app.get('/dashboard/menu', requireAuth, (req,res) => res.sendFile(path.join(__dirname,'public','menu-editor.html')));
app.get('/dashboard/products', requireAuth, (req,res) => res.redirect('/dashboard/menu'));
app.get('/dashboard/qr', requireAuth, (req,res) => res.sendFile(path.join(__dirname,'public','qr.html')));
app.get('/dashboard/settings', requireAuth, (req,res) => res.sendFile(path.join(__dirname,'public','settings.html')));

app.post('/api/auth/register', async (req,res) => {
  const { name, email, password, restaurant } = req.body;
  if (!name || !email || !password || !restaurant || password.length < 8) return res.status(400).json({error:'Informations invalides. Mot de passe : 8 caractères minimum.'});
  const normalized = email.trim().toLowerCase();
  if (db.prepare('SELECT id FROM users WHERE email=?').get(normalized)) return res.status(409).json({error:'Cet email est déjà utilisé.'});
  const user = db.prepare('INSERT INTO users(name,email,password_hash) VALUES(?,?,?)').run(name.trim(),normalized,await bcrypt.hash(password,12));
  const base = slugify(restaurant) || 'restaurant'; let slug=base, i=1;
  while (db.prepare('SELECT id FROM restaurants WHERE slug=?').get(slug)) slug=`${base}-${i++}`;
  const r=db.prepare('INSERT INTO restaurants(user_id,name,slug) VALUES(?,?,?)').run(user.lastInsertRowid,restaurant.trim(),slug);
  db.prepare('INSERT INTO categories(restaurant_id,name,position) VALUES(?,?,0)').run(r.lastInsertRowid,'Nos produits');
  req.session.userId=Number(user.lastInsertRowid); res.json({ok:true,redirect:'/dashboard'});
});
app.post('/api/auth/login',async(req,res)=>{const user=db.prepare('SELECT * FROM users WHERE email=?').get((req.body.email||'').trim().toLowerCase());if(!user||!(await bcrypt.compare(req.body.password||'',user.password_hash)))return res.status(401).json({error:'Email ou mot de passe incorrect.'});req.session.userId=user.id;res.json({ok:true,redirect:'/dashboard'});});
app.post('/api/auth/logout',(req,res)=>req.session.destroy(()=>res.redirect('/')));

app.get('/api/me',requireAuth,(req,res)=>{const r=myRestaurant(req);res.json({user:db.prepare('SELECT id,name,email,created_at FROM users WHERE id=?').get(req.session.userId),restaurant:r});});

app.get('/api/menu',requireAuth,(req,res)=>{const r=myRestaurant(req);const cats=db.prepare('SELECT * FROM categories WHERE restaurant_id=? ORDER BY position,id').all(r.id);cats.forEach(c=>c.products=db.prepare('SELECT * FROM products WHERE category_id=? ORDER BY position,id').all(c.id));res.json(cats);});
app.post('/api/categories',requireAuth,(req,res)=>{const r=myRestaurant(req),name=(req.body.name||'').trim();if(!name)return res.status(400).json({error:'Nom requis'});const x=db.prepare('INSERT INTO categories(restaurant_id,name,position) VALUES(?,?,COALESCE((SELECT MAX(position)+1 FROM categories WHERE restaurant_id=?),0))').run(r.id,name,r.id);res.json({id:x.lastInsertRowid,name});});
app.patch('/api/categories/:id',requireAuth,(req,res)=>{const r=myRestaurant(req),name=(req.body.name||'').trim();const c=db.prepare('SELECT id FROM categories WHERE id=? AND restaurant_id=?').get(req.params.id,r.id);if(!c)return res.status(404).json({error:'Catégorie introuvable'});if(!name)return res.status(400).json({error:'Nom requis'});db.prepare('UPDATE categories SET name=? WHERE id=?').run(name,c.id);res.json({ok:true});});
app.delete('/api/categories/:id',requireAuth,(req,res)=>{const r=myRestaurant(req),c=db.prepare('SELECT id FROM categories WHERE id=? AND restaurant_id=?').get(req.params.id,r.id);if(!c)return res.status(404).json({error:'Catégorie introuvable'});db.prepare('DELETE FROM products WHERE category_id=?').run(c.id);db.prepare('DELETE FROM categories WHERE id=?').run(c.id);res.json({ok:true});});

app.post('/api/products',requireAuth,(req,res)=>{const r=myRestaurant(req);const cat=db.prepare('SELECT id FROM categories WHERE id=? AND restaurant_id=?').get(req.body.category_id,r.id);if(!cat)return res.status(404).json({error:'Catégorie introuvable'});const {name,description,price,image_url,allergens,tags,featured}=req.body;if(!String(name||'').trim()||price===undefined||Number.isNaN(Number(price)))return res.status(400).json({error:'Nom et prix requis'});const pos=db.prepare('SELECT COALESCE(MAX(position)+1,0) p FROM products WHERE category_id=?').get(cat.id).p;const x=db.prepare('INSERT INTO products(category_id,name,description,price,image_url,allergens,tags,featured,position) VALUES(?,?,?,?,?,?,?,?,?)').run(cat.id,String(name).trim(),description||'',Number(price),image_url||'',allergens||'',tags||'',featured?1:0,pos);res.json({id:x.lastInsertRowid});});
app.patch('/api/products/:id',requireAuth,(req,res)=>{const p=ownedProduct(req,req.params.id);if(!p)return res.status(404).json({error:'Produit introuvable'});const allowed=['name','description','price','image_url','available','featured','allergens','tags','category_id','position'];const fields=allowed.filter(k=>req.body[k]!==undefined);if(req.body.category_id!==undefined){const r=myRestaurant(req);if(!db.prepare('SELECT id FROM categories WHERE id=? AND restaurant_id=?').get(req.body.category_id,r.id))return res.status(400).json({error:'Catégorie invalide'});}if(!fields.length)return res.json({ok:true});const sql=`UPDATE products SET ${fields.map(k=>`${k}=?`).join(',')} WHERE id=?`;db.prepare(sql).run(...fields.map(k=>req.body[k]),p.id);res.json({ok:true});});
app.post('/api/products/:id/duplicate',requireAuth,(req,res)=>{const p=ownedProduct(req,req.params.id);if(!p)return res.status(404).json({error:'Produit introuvable'});const x=db.prepare('INSERT INTO products(category_id,name,description,price,image_url,available,position,featured,allergens,tags) VALUES(?,?,?,?,?,?,?,?,?,?)').run(p.category_id,`${p.name} (copie)`,p.description,p.price,p.image_url,p.available,p.position+1,p.featured,p.allergens,p.tags);res.json({id:x.lastInsertRowid});});
app.delete('/api/products/:id',requireAuth,(req,res)=>{const p=ownedProduct(req,req.params.id);if(!p)return res.status(404).json({error:'Produit introuvable'});db.prepare('DELETE FROM products WHERE id=?').run(p.id);res.json({ok:true});});

app.patch('/api/restaurant',requireAuth,(req,res)=>{const r=myRestaurant(req);const fields=['name','description','phone','address','logo_url','theme','accent_color','order_url','instagram','opening_hours'];const used=fields.filter(k=>req.body[k]!==undefined);if(used.length)db.prepare(`UPDATE restaurants SET ${used.map(k=>`${k}=?`).join(',')} WHERE id=?`).run(...used.map(k=>req.body[k]),r.id);res.json({ok:true});});

app.get('/api/qr',requireAuth,async(req,res)=>{const r=myRestaurant(req);const target=`${BASE_URL}/m/${r.slug}`;const data=await QRCode.toDataURL(target,{width:800,margin:2});res.json({target,data});});
app.get('/q/:code',(req,res)=>res.redirect('/m/'+encodeURIComponent(req.params.code)));

app.get('/api/stats',requireAuth,(req,res)=>{const r=myRestaurant(req);const scans30=db.prepare("SELECT COUNT(*) count FROM scans WHERE restaurant_id=? AND created_at>=datetime('now','-30 day')").get(r.id).count;const scans7=db.prepare("SELECT COUNT(*) count FROM scans WHERE restaurant_id=? AND created_at>=datetime('now','-7 day')").get(r.id).count;const products=db.prepare('SELECT COUNT(*) count FROM products p JOIN categories c ON c.id=p.category_id WHERE c.restaurant_id=?').get(r.id).count;const available=db.prepare('SELECT COUNT(*) count FROM products p JOIN categories c ON c.id=p.category_id WHERE c.restaurant_id=? AND p.available=1').get(r.id).count;const categories=db.prepare('SELECT COUNT(*) count FROM categories WHERE restaurant_id=?').get(r.id).count;const daily=db.prepare("SELECT date(created_at) day, COUNT(*) count FROM scans WHERE restaurant_id=? AND created_at>=datetime('now','-30 day') GROUP BY date(created_at) ORDER BY day").all(r.id);res.json({scans:scans30,scans7,products,available,categories,daily});});

app.get('/m/:slug',(req,res)=>{const r=db.prepare('SELECT id FROM restaurants WHERE slug=?').get(req.params.slug);if(!r)return res.status(404).send('Restaurant introuvable');db.prepare('INSERT INTO scans(restaurant_id) VALUES(?)').run(r.id);res.sendFile(path.join(__dirname,'public','menu-public.html'));});
app.get('/api/public/menu/:slug',(req,res)=>{const r=db.prepare('SELECT id,name,description,phone,address,logo_url,theme,accent_color,order_url,instagram,opening_hours FROM restaurants WHERE slug=?').get(req.params.slug);if(!r)return res.status(404).json({error:'Introuvable'});const cats=db.prepare('SELECT * FROM categories WHERE restaurant_id=? ORDER BY position,id').all(r.id);cats.forEach(c=>c.products=db.prepare('SELECT id,name,description,price,image_url,featured,allergens,tags FROM products WHERE category_id=? AND available=1 ORDER BY featured DESC,position,id').all(c.id));res.json({restaurant:r,categories:cats});});

app.listen(PORT,()=>console.log(`QRMenu running on ${BASE_URL}`));
