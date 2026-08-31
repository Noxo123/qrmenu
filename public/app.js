async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Une erreur est survenue');
  return data;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, function (char) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return map[char];
  });
}

function toast(message) {
  document.querySelector('.toast')?.remove();
  const element = document.createElement('div');
  element.className = 'toast';
  element.textContent = message;
  document.body.appendChild(element);
  setTimeout(() => element.remove(), 2600);
}

async function loadMe() {
  return api('/api/me');
}

async function dashboard() {
  const result = await loadMe();
  const user = result.user;
  const restaurant = result.restaurant;

  document.querySelectorAll('[data-user]').forEach(element => {
    element.textContent = user.name;
  });

  document.querySelectorAll('[data-restaurant]').forEach(element => {
    element.textContent = restaurant.name;
  });

  document.querySelectorAll('#publicLink, #publicLinkTop').forEach(element => {
    element.href = '/m/' + restaurant.slug;
  });

  const stats = await api('/api/stats');
  const values = {
    scans: stats.scans,
    scans7: stats.scans7,
    products: stats.products,
    available: stats.available,
    categories: stats.categories
  };

  Object.entries(values).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  });

  const chart = document.getElementById('scanChart');
  if (!chart) return;

  const daily = Array.isArray(stats.daily) ? stats.daily.slice(-14) : [];
  if (!daily.length) {
    chart.innerHTML = '<span class="muted">Pas encore de scans.</span>';
    return;
  }

  const max = Math.max(1, ...daily.map(item => Number(item.count) || 0));
  chart.innerHTML = daily.map(item => {
    const height = Math.max(8, ((Number(item.count) || 0) / max) * 100);
    return '<div class="bar-wrap" title="' + esc(item.day) + ': ' + item.count + ' scan(s)">' +
      '<div class="bar" style="height:' + height + '%"></div>' +
      '<small>' + esc(String(item.day).slice(8)) + '</small>' +
      '</div>';
  }).join('');
}

async function loadMenu() {
  const categories = await api('/api/menu');
  const root = document.getElementById('menuRoot');
  if (!root) return;

  let html = '<div class="menu-tools">' +
    '<input id="menuSearch" class="input" placeholder="🔎 Rechercher un produit…" oninput="filterMenu(this.value)">' +
    '<button class="btn light" onclick="addCategory()">+ Catégorie</button>' +
    '<button class="btn green" onclick="addProduct()">+ Produit</button>' +
    '</div>';

  if (!categories.length) {
    root.innerHTML = html + '<div class="empty">Aucune catégorie.<br><button class="btn green small" style="margin-top:12px" onclick="addCategory()">Créer ma première catégorie</button></div>';
    return;
  }

  html += categories.map(category => {
    const products = category.products || [];
    return '<section class="card menu-category" data-category="' + category.id + '">' +
      '<div class="category-head">' +
        '<div><h2>' + esc(category.name) + '</h2><span class="muted category-count">' + products.length + ' produit' + (products.length > 1 ? 's' : '') + '</span></div>' +
        '<div class="product-actions">' +
          '<button class="btn light small" onclick="renameCategory(' + category.id + ', ' + JSON.stringify(category.name) + ')">✎</button>' +
          '<button class="btn danger small" onclick="deleteCategory(' + category.id + ')">Supprimer</button>' +
          '<button class="btn green small" onclick="addProduct(' + category.id + ')">+ Produit</button>' +
        '</div>' +
      '</div>' +
      '<div class="products-list">' +
        (products.length ? products.map(product => productHtml(product, category.id)).join('') : '<div class="empty">Cette catégorie est vide.</div>') +
      '</div>' +
    '</section>';
  }).join('');

  root.innerHTML = html;
}

function productHtml(product, categoryId) {
  const data = JSON.stringify({
    name: product.name,
    description: product.description || '',
    price: product.price,
    image_url: product.image_url || '',
    allergens: product.allergens || '',
    tags: product.tags || '',
    featured: Boolean(product.featured),
    category_id: categoryId
  }).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

  return '<article class="product" data-product data-name="' + esc((product.name + ' ' + (product.description || '')).toLowerCase()) + '">' +
    (product.image_url ? '<img class="product-thumb" src="' + esc(product.image_url) + '" alt="">' : '') +
    '<div style="min-width:0;flex:1">' +
      '<div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap">' +
        '<strong>' + esc(product.name) + '</strong>' +
        (product.featured ? '<span class="pill">⭐ Vedette</span>' : '') +
      '</div>' +
      '<div class="muted" style="margin:3px 0;font-size:13px">' + esc(product.description || 'Sans description') + '</div>' +
      '<div><b>' + Number(product.price).toFixed(2) + ' €</b>' + (product.tags ? ' <span class="muted">· ' + esc(product.tags) + '</span>' : '') + '</div>' +
    '</div>' +
    '<div class="product-actions">' +
      '<button class="btn ' + (product.available ? 'soft' : 'light') + ' small" onclick="toggleProduct(' + product.id + ',' + (product.available ? 0 : 1) + ')">' + (product.available ? '✓ En ligne' : '○ Masqué') + '</button>' +
      '<button class="btn light small" onclick="editProduct(' + product.id + ', ' + data + ')">✎ Modifier</button>' +
      '<button class="btn light small" onclick="duplicateProduct(' + product.id + ')">⧉</button>' +
      '<button class="btn danger small" onclick="deleteProduct(' + product.id + ')">×</button>' +
    '</div>' +
  '</article>';
}

function filterMenu(query) {
  const value = query.toLowerCase().trim();
  document.querySelectorAll('[data-product]').forEach(product => {
    product.style.display = !value || product.dataset.name.includes(value) ? 'flex' : 'none';
  });
}

async function addCategory() {
  const name = prompt('Nom de la catégorie');
  if (!name || !name.trim()) return;
  try {
    await api('/api/categories', { method: 'POST', body: JSON.stringify({ name: name.trim() }) });
    toast('Catégorie créée');
    await loadMenu();
  } catch (error) { toast(error.message); }
}

async function renameCategory(id, current) {
  const name = prompt('Nouveau nom', current);
  if (!name || !name.trim() || name === current) return;
  try {
    await api('/api/categories/' + id, { method: 'PATCH', body: JSON.stringify({ name: name.trim() }) });
    toast('Catégorie renommée');
    await loadMenu();
  } catch (error) { toast(error.message); }
}

async function deleteCategory(id) {
  if (!confirm('Supprimer cette catégorie et tous ses produits ?')) return;
  try {
    await api('/api/categories/' + id, { method: 'DELETE' });
    toast('Catégorie supprimée');
    await loadMenu();
  } catch (error) { toast(error.message); }
}

async function addProduct(categoryId) {
  try {
    const categories = await api('/api/menu');
    if (!categories.length) return toast('Créez d’abord une catégorie');
    const category = categories.find(item => item.id === categoryId) || categories[0];
    const name = prompt('Nom du produit');
    if (!name || !name.trim()) return;
    const price = prompt('Prix TTC (€)', '10.00');
    if (price === null || Number.isNaN(Number(price))) return toast('Prix invalide');
    const description = prompt('Description', '') || '';
    const image_url = prompt('URL de l’image (optionnel)', '') || '';
    const tags = prompt('Tags (ex: végétarien, épicé)', '') || '';
    const allergens = prompt('Allergènes (optionnel)', '') || '';
    const featured = confirm('Mettre ce produit en vedette ?');

    await api('/api/products', {
      method: 'POST',
      body: JSON.stringify({ category_id: category.id, name: name.trim(), price: Number(price), description, image_url, tags, allergens, featured })
    });
    toast('Produit ajouté');
    await loadMenu();
  } catch (error) { toast(error.message); }
}

async function editProduct(id, product) {
  const name = prompt('Nom', product.name);
  if (!name || !name.trim()) return;
  const price = prompt('Prix TTC (€)', product.price);
  if (price === null || Number.isNaN(Number(price))) return toast('Prix invalide');
  const description = prompt('Description', product.description) || '';
  const image_url = prompt('URL image', product.image_url) || '';
  const tags = prompt('Tags', product.tags) || '';
  const allergens = prompt('Allergènes', product.allergens) || '';
  const featured = confirm('Produit vedette ?');

  try {
    await api('/api/products/' + id, {
      method: 'PATCH',
      body: JSON.stringify({ name: name.trim(), price: Number(price), description, image_url, tags, allergens, featured })
    });
    toast('Produit modifié');
    await loadMenu();
  } catch (error) { toast(error.message); }
}

async function toggleProduct(id, available) {
  try {
    await api('/api/products/' + id, { method: 'PATCH', body: JSON.stringify({ available }) });
    toast(available ? 'Produit publié' : 'Produit masqué');
    await loadMenu();
  } catch (error) { toast(error.message); }
}

async function duplicateProduct(id) {
  try {
    await api('/api/products/' + id + '/duplicate', { method: 'POST' });
    toast('Produit dupliqué');
    await loadMenu();
  } catch (error) { toast(error.message); }
}

async function deleteProduct(id) {
  if (!confirm('Supprimer définitivement ce produit ?')) return;
  try {
    await api('/api/products/' + id, { method: 'DELETE' });
    toast('Produit supprimé');
    await loadMenu();
  } catch (error) { toast(error.message); }
}

async function loadQR() {
  try {
    const qr = await api('/api/qr');
    const image = document.querySelector('#qrImage');
    if (image) image.src = qr.data;
    const target = document.querySelector('#qrTarget');
    if (target) target.textContent = qr.target;
    const download = document.querySelector('#qrDownload');
    if (download) {
      download.href = qr.data;
      download.download = 'qrmenu.png';
    }
    const copy = document.querySelector('#copyQR');
    if (copy) copy.onclick = async () => {
      await navigator.clipboard.writeText(qr.target);
      toast('Lien copié !');
    };
  } catch (error) { toast(error.message); }
}

async function saveSettings() {
  const button = document.querySelector('#saveSettings');
  if (button) {
    button.disabled = true;
    button.textContent = 'Enregistrement…';
  }

  try {
    const ids = ['name', 'description', 'phone', 'address', 'logo_url', 'theme', 'accent_color', 'order_url', 'instagram', 'opening_hours'];
    const data = {};
    ids.forEach(id => {
      const element = document.getElementById(id);
      if (element) data[id] = element.value;
    });
    await api('/api/restaurant', { method: 'PATCH', body: JSON.stringify(data) });
    toast('Paramètres enregistrés');
  } catch (error) {
    toast(error.message);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = 'Enregistrer les modifications';
    }
  }
}