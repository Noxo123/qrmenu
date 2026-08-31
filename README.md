# QRMenu

SaaS de menus numériques et QR codes pour restaurants, snacks, cafés, food-trucks et commerces.

## Routes principales

### Web
- `/` — landing page
- `/register` — inscription
- `/login` — connexion
- `/dashboard` — tableau de bord
- `/dashboard/menu` — éditeur de menu
- `/dashboard/qr` — QR code
- `/dashboard/settings` — paramètres du restaurant
- `/dashboard/developer` — clés API et intégrations
- `/m/:slug` — menu public
- `/api-docs` — Swagger UI
- `/api-docs/openapi.json` — spécification OpenAPI 3.0.3

### API interne du dashboard
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/me`
- `GET /api/menu`
- `POST/PATCH/DELETE /api/categories...`
- `POST/PATCH/DELETE /api/products...`
- `PATCH /api/restaurant`
- `GET /api/qr`
- `GET /api/stats`

### API publique v1
- `GET /api/v1/health` — public
- `GET /api/v1/menu/:slug`
- `GET /api/v1/restaurants/:slug`
- `GET /api/v1/categories/:slug`
- `GET /api/v1/products/:slug`
- `GET /api/v1/products/:slug/:id`
- `GET /api/v1/search/:slug?q=...`

Toutes les routes v1 sauf `health` utilisent :

```http
Authorization: Bearer qm_live_xxxxxxxxx
```

Les clés sont hashées en SHA-256 et ne sont jamais stockées en clair.

## Installation

```bash
npm install
npm start
```

Développement :

```bash
npm run dev
```

Copier `.env.example` vers `.env` et adapter les valeurs.

Variables principales :

```env
NODE_ENV=development
PORT=3000
BASE_URL=http://localhost:3000
DB_PATH=./database.sqlite
SESSION_SECRET=change-me
CORS_ORIGIN=http://localhost:3000
API_RATE_LIMIT=100
LOGIN_RATE_LIMIT=10
REGISTER_RATE_LIMIT=5
```

## Sécurité actuelle

- Helmet
- CORS configurable
- rate limiting pour authentification et API v1
- cookies de session `httpOnly` / `sameSite=lax`
- `secure` automatiquement activé en production
- bcrypt pour les mots de passe
- clés API stockées sous forme de hash
- contrôle d'appartenance restaurant sur les ressources du dashboard
- requêtes SQLite paramétrées
- gestion JSON des erreurs API
- index SQLite pour les requêtes fréquentes

## Production

Avant une mise en production complète, prévoir notamment :

- HTTPS obligatoire
- `SESSION_SECRET` long et aléatoire
- vrai store de sessions partagé (Redis ou base adaptée) à la place du MemoryStore Express
- protection CSRF pour les actions authentifiées basées sur cookie
- stockage objet/CDN pour les images
- sauvegardes SQLite automatisées si SQLite reste utilisé
- monitoring et alerting
- politique de confidentialité et conservation minimale des données

## Tests CI

GitHub Actions vérifie automatiquement :

- installation npm
- syntaxe de `server.js`, `src/db.js` et `src/openapi.js`
- démarrage du serveur
- `/api/v1/health`
- `/api-docs`
- `/api-docs/openapi.json`
