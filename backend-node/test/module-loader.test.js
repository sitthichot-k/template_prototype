'use strict';

/**
 * Kernel contract tests, run against the real modules on disk.
 *
 * These exist because of a bug that every static check passed: only the
 * settings module called `validateDescriptor` on its own descriptors, so the
 * access-control module's settings reached the registry without the schema's
 * defaults. Nothing failed until `/platform/bootstrap` tried to read
 * `descriptor.scopes` and got undefined - a 500 on the single most important
 * endpoint in the platform.
 *
 * The lesson generalised: a default that each module must remember to apply
 * is not a default. The loader applies it now, and these tests assert that it
 * still does.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { discoverModuleDirs, loadManifest, resolveBootOrder } = require('../server/core/kernel/module-loader');
const { TYPES, SCOPES } = require('../server/core/settings/setting-descriptor');

const manifests = discoverModuleDirs().map(loadManifest);

test('every module on disk loads and validates', () => {
  assert.ok(manifests.length >= 3, 'expected at least the three phase-1 modules');

  const ids = manifests.map((m) => m.id);
  for (const required of ['access-control', 'settings', 'platform']) {
    assert.ok(ids.includes(required), `core module "${required}" is missing`);
  }
});

test('the loader applies descriptor defaults to EVERY module, not just its own', () => {
  let checked = 0;

  for (const manifest of manifests) {
    for (const descriptor of manifest.settings) {
      checked += 1;

      // The three the loader fills in and that consumers rely on.
      assert.ok(
        Array.isArray(descriptor.scopes) && descriptor.scopes.length > 0,
        `${manifest.id}: setting "${descriptor.key}" has no scopes - settings-service.get would throw`
      );
      assert.equal(typeof descriptor.order, 'number', `${manifest.id}: "${descriptor.key}" has no order`);
      assert.equal(typeof descriptor.secret, 'boolean', `${manifest.id}: "${descriptor.key}" has no secret flag`);

      for (const scope of descriptor.scopes) {
        assert.ok(SCOPES.includes(scope), `${manifest.id}: "${descriptor.key}" has unknown scope "${scope}"`);
      }
      assert.ok(TYPES.includes(descriptor.type), `${manifest.id}: "${descriptor.key}" has unknown type`);
      assert.ok(descriptor.permission && descriptor.permission.resource, `${manifest.id}: "${descriptor.key}" has no permission`);
    }
  }

  assert.ok(checked > 20, `expected the phase-1 settings catalogue, saw ${checked}`);
});

test('every setting key is unique across modules', () => {
  const seen = new Map();

  for (const manifest of manifests) {
    for (const descriptor of manifest.settings) {
      assert.equal(
        seen.has(descriptor.key),
        false,
        `duplicate setting key "${descriptor.key}" in "${manifest.id}" and "${seen.get(descriptor.key)}"`
      );
      seen.set(descriptor.key, manifest.id);
    }
  }
});

test('every permission a setting or menu item references is declared somewhere', () => {
  const declared = new Set();
  for (const manifest of manifests) {
    for (const permission of manifest.permissions) declared.add(permission.resource);
  }

  for (const manifest of manifests) {
    for (const descriptor of manifest.settings) {
      assert.ok(
        declared.has(descriptor.permission.resource),
        `${manifest.id}: setting "${descriptor.key}" needs undeclared "${descriptor.permission.resource}"`
      );
    }

    const walk = (nodes) => {
      for (const node of nodes || []) {
        if (node.permission) {
          assert.ok(
            declared.has(node.permission.resource),
            `${manifest.id}: menu "${node.id}" needs undeclared "${node.permission.resource}"`
          );
        }
        walk(node.children);
      }
    };
    walk(manifest.menu);
  }
});

test('module dependencies resolve without a cycle', () => {
  const ordered = resolveBootOrder(manifests);
  const position = new Map(ordered.map((m, index) => [m.id, index]));

  for (const manifest of manifests) {
    for (const dependency of manifest.dependsOn) {
      assert.ok(
        position.get(dependency) < position.get(manifest.id),
        `"${manifest.id}" must boot after its dependency "${dependency}"`
      );
    }
  }
});

test('core modules boot before feature modules', () => {
  for (const manifest of manifests) {
    if (['access-control', 'settings', 'platform'].includes(manifest.id)) {
      assert.ok(manifest.order < 100, `core module "${manifest.id}" should have order < 100`);
    }
  }
});
