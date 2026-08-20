'use strict';

/**
 * OpenAPI document, generated from the live module registry.
 *
 * Building it from the registry rather than a checked-in spec file means the
 * documentation cannot drift from the code: a route that is not mounted does
 * not appear, and every endpoint's permission requirement is described
 * because the registry knows it.
 *
 * Disabled in production - the document enumerates every endpoint and
 * permission, which is reconnaissance material.
 */

const swaggerUi = require('swagger-ui-express');
const config = require('./index');

function buildDocument(registry) {
  const paths = {};

  for (const route of registry.routes) {
    const base = `${config.http.apiPrefix}${route.basePath}`;
    paths[base] = paths[base] || {};
    paths[base]['x-module'] = route.moduleId;
  }

  return {
    openapi: '3.0.3',
    info: {
      title: `${config.project.name} API`,
      version: config.project.version,
      description:
        `${config.project.description}\n\n` +
        '## Response envelope\n\n' +
        'Success: `{ "success": true, "data": ..., "meta": { ... } }`\n\n' +
        'Failure: `{ "success": false, "error": { "code", "message", "details" }, "requestId" }`\n\n' +
        '## Authorization\n\n' +
        'Every protected endpoint requires a bearer access token and a permission ' +
        'expressed as `resource` + `action`. `GET /platform/bootstrap` returns the ' +
        'caller\'s effective permissions.\n\n' +
        '## List queries\n\n' +
        'Collection endpoints accept `?page=&limit=&sort=&q=&filter[field]=`.'
    },
    servers: [{ url: config.http.apiPrefix, description: config.env.appEnv }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', example: 'FORBIDDEN' },
                message: { type: 'string' },
                details: { type: 'object' }
              }
            },
            requestId: { type: 'string' }
          }
        },
        Pagination: {
          type: 'object',
          properties: {
            page: { type: 'integer' },
            limit: { type: 'integer' },
            total: { type: 'integer' },
            totalPages: { type: 'integer' }
          }
        }
      }
    },
    security: [{ bearerAuth: [] }],
    tags: registry.listModules().map((module) => ({
      name: module.id,
      description: module.description
    })),
    paths,
    // Not part of the OpenAPI standard, but the most useful thing this
    // document can carry: the full permission catalogue the API enforces.
    'x-permissions': registry.listPermissions()
  };
}

function mountSwagger(app, registry) {
  const document = buildDocument(registry);

  app.get('/docs.json', (req, res) => res.json(document));
  app.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(document, {
      customSiteTitle: `${config.project.name} API`,
      swaggerOptions: { persistAuthorization: true, docExpansion: 'none' }
    })
  );
}

module.exports = { mountSwagger, buildDocument };
