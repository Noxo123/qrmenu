# QRMenu

SaaS simple de menus numériques et QR codes intelligents pour restaurants, snacks, cafés et food-trucks.

## Routes

- `/` — landing page
- `/register` — inscription
- `/login` — connexion
- `/dashboard` — tableau de bord
- `/dashboard/menu` — gestion du menu
- `/dashboard/qr` — QR code
- `/dashboard/settings` — paramètres
- `/m/:slug` — menu public

## Installation

```bash
npm install
npm start
```

Variables facultatives:

```env
PORT=3000
BASE_URL=https://qrmenu.fr
SESSION_SECRET=change-me
DB_PATH=./database.sqlite
```

> MVP: avant production, utiliser un vrai store de sessions, HTTPS, validation stricte des entrées, limitation de débit, CSRF et stockage objet pour les images.
