function buildOpenApi(baseUrl) {
  const response = (description, schema) => ({ description, content: { 'application/json': { schema } } });
  const success = { type: 'object', properties: { success: { type: 'boolean', example: true }, data: { type: 'object' } }, required: ['success', 'data'] };
  const error = { type: 'object', properties: { success: { type: 'boolean', example: false }, error: { type: 'object', properties: { code: { type: 'string', example: 'VALIDATION_ERROR' }, message: { type: 'string' }, details: { type: 'object' } }, required: ['code', 'message'] } }, required: ['success', 'error'] };
  const slug = { name: 'slug', in: 'path', required: true, schema: { type: 'string', example: 'restaurant-demo' } };
  const auth = [{ BearerAuth: [] }];
  const commonResponses = { '401': response('Token absent, invalide ou révoqué', { $ref: '#/components/schemas/Error' }), '403': response('Accès refusé', { $ref: '#/components/schemas/Error' }), '404': response('Ressource introuvable', { $ref: '#/components/schemas/Error' }), '429': response('Quota mensuel ou rate limit atteint', { $ref: '#/components/schemas/Error' }) };
  const restaurantInput = { type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 120, example: 'Chez Marius' }, slug: { type: 'string', maxLength: 60, example: 'chez-marius' }, description: { type: 'string' }, phone: { type: 'string' }, address: { type: 'string' }, logo_url: { type: 'string', format: 'uri' }, theme: { type: 'string' }, accent_color: { type: 'string' }, order_url: { type: 'string', format: 'uri' }, instagram: { type: 'string' }, opening_hours: { type: 'string' } } };
  const idPath = { name: 'id', in: 'path', required: true, schema: { type: 'integer' } };
  return {
    openapi: '3.0.3',
    info: { title: 'QRMenu API', version: '1.2.0', description: 'API QRMenu pour créer des restaurants, gérer des intégrations et récupérer des menus. Le plan gratuit inclut 1 token API et 500 requêtes par mois. Les tokens supplémentaires sont réservés aux abonnements payants.' },
    servers: [{ url: baseUrl, description: 'Serveur QRMenu actuel' }],
    tags: [
      { name: 'Health' }, { name: 'Restaurants' }, { name: 'Menu' }, { name: 'Categories' }, { name: 'Products' }, { name: 'Search' }, { name: 'Usage' }, { name: 'QR Codes' }
    ],
    components: {
      securitySchemes: { BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'API_TOKEN', description: 'Token qm_tok_... créé depuis le dashboard. Les anciennes clés qm_live_ restent compatibles.' } },
      schemas: {
        Error: error,
        Product: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' }, description: { type: 'string' }, price: { type: 'number' }, image_url: { type: 'string' }, featured: { type: 'integer' }, allergens: { type: 'string' }, tags: { type: 'string' }, available: { type: 'integer' }, position: { type: 'integer' }, category_id: { type: 'integer' }, category_name: { type: 'string' } } },
        Category: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' }, position: { type: 'integer' }, products: { type: 'array', items: { $ref: '#/components/schemas/Product' } } } },
        Restaurant: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' }, slug: { type: 'string' }, description: { type: 'string' }, phone: { type: 'string' }, address: { type: 'string' }, logo_url: { type: 'string' }, theme: { type: 'string' }, accent_color: { type: 'string' }, order_url: { type: 'string' }, instagram: { type: 'string' }, opening_hours: { type: 'string' }, created_at: { type: 'string' } } },
        ApiResponse: success,
        CreateRestaurant: restaurantInput,
        CreateRestaurantResponse: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object', properties: { restaurant: { $ref: '#/components/schemas/Restaurant' }, default_category_id: { type: 'integer' }, menu_url: { type: 'string' } } } } },
        Reorder: { type: 'object', required: ['ids'], properties: { ids: { type: 'array', items: { type: 'integer' } } } },
        Feedback: { type: 'object', properties: { rating: { type: 'integer', minimum: 1, maximum: 5 }, comment: { type: 'string', maxLength: 1000 } } }
      }
    },
    paths: {
      '/api/v1/health': { get: { tags: ['Health'], security: [], summary: 'Vérifier que l’API fonctionne', responses: { '200': response('API opérationnelle', success) } } },
      '/api/v1/usage': { get: { tags: ['Usage'], security: auth, summary: 'Consulter le quota du token', responses: { '200': response('Quota et tokens', success), ...commonResponses } } },
      '/api/v1/restaurants': {
        get: { tags: ['Restaurants'], security: auth, summary: 'Lister les restaurants du compte', responses: { '200': response('Liste des restaurants', success), ...commonResponses } },
        post: { tags: ['Restaurants'], security: auth, summary: 'Créer un restaurant depuis l’API', requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateRestaurant' } } } }, responses: { '201': response('Restaurant créé', { $ref: '#/components/schemas/CreateRestaurantResponse' }), '402': response('Abonnement requis', error), '422': response('Données invalides', error), ...commonResponses } }
      },
      '/api/v1/menu/{slug}': { get: { tags: ['Menu'], security: auth, summary: 'Récupérer le menu complet', parameters: [slug], responses: { '200': response('Menu complet', success), ...commonResponses } } },
      '/api/v1/restaurants/{slug}': { get: { tags: ['Restaurants'], security: auth, summary: 'Informations du restaurant', parameters: [slug], responses: { '200': response('Restaurant', success), ...commonResponses } } },
      '/api/v1/categories/{slug}': { get: { tags: ['Categories'], security: auth, summary: 'Catégories et produits', parameters: [slug], responses: { '200': response('Catégories', success), ...commonResponses } } },
      '/api/v1/products/{slug}': { get: { tags: ['Products'], security: auth, summary: 'Lister les produits disponibles', parameters: [slug], responses: { '200': response('Produits', success), ...commonResponses } } },
      '/api/v1/products/{slug}/{id}': { get: { tags: ['Products'], security: auth, summary: 'Récupérer un produit', parameters: [slug, idPath], responses: { '200': response('Produit', success), ...commonResponses } } },
      '/api/v1/search/{slug}': { get: { tags: ['Search'], security: auth, summary: 'Rechercher dans le menu', parameters: [slug, { name: 'q', in: 'query', required: true, schema: { type: 'string', minLength: 1 }, example: 'pizza' }], responses: { '200': response('Résultats', success), '400': response('Paramètre q manquant', error), ...commonResponses } } },
      '/api/v1/qr-codes': { get: { tags: ['QR Codes'], security: auth, summary: 'Lister les QR codes du restaurant', responses: { '200': response('QR codes', success), ...commonResponses } }, post: { tags: ['QR Codes'], security: auth, summary: 'Créer un QR code personnalisé', requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' } } } } } }, responses: { '201': response('QR créé', success), ...commonResponses } } }
    }
  };
}
module.exports = { buildOpenApi };
