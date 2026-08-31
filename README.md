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
- `/dashboard/developer` — tokens API et intégrations
- `/m/:slug` — menu public
- `/api-docs` — Swagger UI
- `/api-docs/openapi.json` — spécification OpenAPI 3.0.3

### API publique v1

`GET /api/v1/health` est public. Les autres routes utilisent un token :

```http
Authorization: Bearer qm_tok_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Le plan gratuit inclut **1 token par utilisateur et 500 requêtes par mois**. Le token est stocké uniquement sous forme de hash. Les tokens supplémentaires sont réservés aux abonnements payants.

#### Gestion du compte API

```text
GET  /api/v1/usage
GET  /api/v1/restaurants
POST /api/v1/restaurants
```

`POST /api/v1/restaurants` permet de provisionner un nouveau restaurant directement depuis une autre application.

Exemple :

```bash
curl -X POST http://localhost:3000/api/v1/restaurants ^
  -H "Authorization: Bearer qm_tok_VOTRE_TOKEN" ^
  -H "Content-Type: application/json" ^
  -d "{\"name\":\"Chez Marius\",\"slug\":\"chez-marius\",\"description\":\"Cuisine maison\"}"
```

Réponse :

```json
{
  "success": true,
  "data": {
    "restaurant": {
      "id": 2,
      "name": "Chez Marius",
      "slug": "chez-marius"
    },
    "default_category_id": 4,
    "menu_url": "http://localhost:3000/m/chez-marius"
  }
}
```

Autres endpoints :

```text
GET /api/v1/menu/:slug
GET /api/v1/restaurants/:slug
GET /api/v1/categories/:slug
GET /api/v1/products/:slug
GET /api/v1/products/:slug/:id
GET /api/v1/search/:slug?q=...
```

Les tokens renvoient les en-têtes de quota :

```text
X-RateLimit-Limit
X-RateLimit-Remaining
X-RateLimit-Reset
```

Quand les 500 requêtes mensuelles sont consommées : `429 QUOTA_EXCEEDED`.

### Tokens du dashboard

```text
GET    /api/developer/tokens
GET    /api/developer/usage
POST   /api/developer/tokens
DELETE /api/developer/tokens/:id
```

Création d'un token :

```json
{
  "name": "Mon application"
}
```

Le token complet est affiché une seule fois.

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

### Compatibilité legacy

Les anciennes clés `qm_live_...` restent compatibles avec les endpoints de lecture existants, mais les nouvelles intégrations doivent utiliser `qm_tok_...`.

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
- quota mensuel par token
- cookies de session `httpOnly` / `sameSite=lax`
- `secure` automatiquement activé en production
- bcrypt pour les mots de passe
- tokens API stockés sous forme de hash SHA-256
- contrôle d'appartenance restaurant pour les ressources du dashboard et de l'API
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
- intégration Stripe ou autre prestataire pour activer automatiquement les plans payants
- politique de confidentialité et conservation minimale des données

## Tests CI

GitHub Actions vérifie automatiquement :

- installation npm
- syntaxe de `server.js`, `src/db.js`, `src/openapi.js` et `src/api-tokens.js`
- démarrage du serveur
- `/api/v1/health`
- `/api-docs`
- `/api-docs/openapi.json`
