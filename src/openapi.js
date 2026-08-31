function buildOpenApi(baseUrl) {
  const json = (description, schema) => ({ description, content: { 'application/json': { schema } } });
  const success = { type: 'object', properties: { success: { type: 'boolean', example: true }, data: { type: 'object' } } };
  const error = { type: 'object', properties: { success: { type: 'boolean', example: false }, error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } }, required: ['code', 'message'] } }, required: ['success', 'error'] };
  const slug = { name: 'slug', in: 'path', required: true, schema: { type: 'string', example: 'restaurant-demo' } };
  const commonResponses = { '401': json('Clé API absente ou invalide', { $ref: '#/components/schemas/Error' }), '403': json('Accès refusé', { $ref: '#/components/schemas/Error' }), '404': json('Ressource introuvable', { $ref: '#/components/schemas/Error' }) };

  return {
    openapi: '3.0.3',
    info: {
      title: 'QRMenu API',
      version: '1.0.0',
      description: 'API publique QRMenu pour intégrer les menus numériques dans des applications tierces.'
    },
    servers: [{ url: baseUrl, description: 'Serveur QRMenu actuel' }],
    tags: [{ name: 'Health' }, { name: 'Menu' }, { name: 'Restaurant' }, { name: 'Categories' }, { name: 'Products' }, { name: 'Search' }],
    components: {
      securitySchemes: {
        BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'API_KEY', description: 'Utilisez une clé qm_live_... créée depuis le dashboard.' }
      },
      schemas: {
        Error: error,
        Product: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' }, description: { type: 'string' }, price: { type: 'number', format: 'float' }, image_url: { type: 'string' }, featured: { type: 'integer' }, allergens: { type: 'string' }, tags: { type: 'string' }, available: { type: 'integer' }, position: { type: 'integer' }, category_id: { type: 'integer' }, category_name: { type: 'string' } } },
        Category: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' }, position: { type: 'integer' }, products: { type: 'array', items: { $ref: '#/components/schemas/Product' } } } },
        Restaurant: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' }, slug: { type: 'string' }, description: { type: 'string' }, phone: { type: 'string' }, address: { type: 'string' }, logo_url: { type: 'string' }, theme: { type: 'string' }, accent_color: { type: 'string' }, order_url: { type: 'string' }, instagram: { type: 'string' }, opening_hours: { type: 'string' } } },
        ApiResponse: success
      }
    },
    paths: {
      '/api/v1/health': { get: { tags: ['Health'], security: [], summary: 'Vérifier que l’API fonctionne', responses: { '200': json('API opérationnelle', success) } } },
      '/api/v1/menu/{slug}': { get: { tags: ['Menu'], summary: 'Récupérer le menu complet', security: [{ BearerAuth: [] }], parameters: [slug], responses: { '200': json('Menu complet', success), ...commonResponses } } },
      '/api/v1/restaurants/{slug}': { get: { tags: ['Restaurant'], summary: 'Récupérer les informations du restaurant', security: [{ BearerAuth: [] }], parameters: [slug], responses: { '200': json('Restaurant', success), ...commonResponses } } },
      '/api/v1/categories/{slug}': { get: { tags: ['Categories'], summary: 'Récupérer les catégories et leurs produits', security: [{ BearerAuth: [] }], parameters: [slug], responses: { '200': json('Catégories', success), ...commonResponses } } },
      '/api/v1/products/{slug}': { get: { tags: ['Products'], summary: 'Lister les produits disponibles', security: [{ BearerAuth: [] }], parameters: [slug], responses: { '200': json('Produits', success), ...commonResponses } } },
      '/api/v1/products/{slug}/{id}': { get: { tags: ['Products'], summary: 'Récupérer un produit', security: [{ BearerAuth: [] }], parameters: [slug, { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': json('Produit', success), ...commonResponses } } },
      '/api/v1/search/{slug}': { get: { tags: ['Search'], summary: 'Rechercher dans les produits', security: [{ BearerAuth: [] }], parameters: [slug, { name: 'q', in: 'query', required: true, schema: { type: 'string', minLength: 1 }, example: 'pizza' }], responses: { '200': json('Résultats de recherche', success), '400': json('Paramètre q manquant', error), ...commonResponses } } }
    }
  };
}

module.exports = { buildOpenApi };
