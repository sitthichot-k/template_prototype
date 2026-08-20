<script setup>
/**
 * Permission matrix.
 *
 * One grid answering the question every access review starts with: for a given
 * group, which action is switched on for which resource?
 *
 * This is the *only* place grants are edited. The role screen used to offer a
 * second editor for the same data, which meant two places to look when an
 * audit asked who changed what; it now links here as
 * `/security/permissions/<ROLE_CODE>`.
 *
 * Two data sources meet here and neither is duplicated:
 *
 *   - the *columns and rows* come from `/permissions/catalogue`, which the
 *     backend derives from module manifests. What permissions exist stays a
 *     code decision, so the grid can never offer a rule the API does not know.
 *   - the *switch states* come from the selected role's grants. Toggling one
 *     stages a change locally and `PATCH /roles/:id` writes it - the same
 *     endpoint, and the same server-side validation, as any other caller.
 *
 * A user holding only `/security/permissions:view` still gets a useful page:
 * the role list is optional, and without it the grid shows what each resource
 * declares rather than who holds it.
 */

import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import api from '@/services/api';
import { usePlatformStore } from '@/stores/platform.store';

import { formatDateTime } from '@/composables/useFormat';
const platform = usePlatformStore();
const route = useRoute();
const router = useRouter();

const catalogue = ref([]);
const roles = ref([]);
const selectedRoleId = ref('');

/**
 * `resource -> Set(actions)`. `baseline` is what the server last confirmed and
 * `draft` is what the switches show, which is what makes "unsaved changes"
 * answerable without re-fetching.
 */
const baseline = ref({});
const draft = ref({});

const loading = ref(true);
const saving = ref(false);
const error = ref('');
const notice = ref('');
const lastLoadedAt = ref(null);

const filter = ref('');
const typeFilter = ref('');
const pageSize = ref(20);
const page = ref(1);
const sort = ref({ key: 'menu', direction: 'asc' });

/* --- Loading ---------------------------------------------------------------- */

onMounted(load);

async function load() {
  loading.value = true;
  error.value = '';

  try {
    const [catalogueData, roleItems] = await Promise.all([api.get('/permissions/catalogue'), loadRoles()]);

    catalogue.value = catalogueData.groups;
    roles.value = roleItems;

    // The URL selects the group; anything unrecognised falls back to the
    // highest-priority role, the one an admin most likely came to look at.
    selectedRoleId.value = resolveRoleId() || roles.value[0]?.id || '';

    resetDraft();
    lastLoadedAt.value = new Date();
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

/**
 * Which role the URL is asking for.
 *
 * The path segment is a role code. `?group=<id>` is still honoured so links
 * saved before the move keep working - the first selection change rewrites
 * them to the readable form.
 */
function resolveRoleId() {
  const code = String(route.params.group || '').toUpperCase();
  if (code) {
    const match = roles.value.find((role) => role.code === code);
    if (match) return match.id;
  }

  const legacyId = String(route.query.group || '');
  if (legacyId && roles.value.some((role) => role.id === legacyId)) return legacyId;

  // Nothing in the URL: keep whatever is already selected across a refresh.
  return roles.value.some((role) => role.id === selectedRoleId.value) ? selectedRoleId.value : '';
}

/**
 * Roles are a bonus, not a requirement. Asking for them without the permission
 * would turn a readable page into an error, so a refusal is absorbed here.
 */
async function loadRoles() {
  if (!platform.can('/security/roles', 'view')) return [];

  try {
    const { items } = await api.list('/roles', { limit: 200, sort: '-priority' });
    return items;
  } catch {
    return [];
  }
}

function refresh() {
  if (dirtyCount.value && !window.confirm('Reloading discards unsaved permission changes. Continue?')) return;
  notice.value = '';
  load();
}

/* --- Rows and columns ------------------------------------------------------- */

/** The grouped catalogue flattened into table rows. */
const rows = computed(() =>
  catalogue.value.flatMap((group) =>
    group.items.map((item) => ({
      resource: item.resource,
      menu: item.label,
      description: item.description,
      type: group.group,
      actions: item.actions,
      dangerous: Boolean(item.dangerous)
    }))
  )
);

// Familiar verbs first, so `view` never lands to the right of `export`.
const ACTION_ORDER = ['view', 'create', 'edit', 'delete', 'assign', 'revoke', 'reset-password', 'export'];

const ACTION_ACCENT = {
  view: '#3b82f6',
  create: '#10b981',
  edit: '#f59e0b',
  delete: '#ef4444',
  assign: '#8b5cf6',
  revoke: '#ec4899',
  'reset-password': '#f97316',
  export: '#06b6d4'
};

const FALLBACK_ACCENTS = ['#6366f1', '#14b8a6', '#a855f7', '#0ea5e9', '#84cc16'];

/**
 * What each switch actually buys the holder.
 *
 * Written in terms of what the person can *do*, not what the flag is called:
 * "Delete" is obvious, "Assign" is not, and the difference between Edit and
 * Assign on a role is exactly the kind of thing that gets granted by accident.
 */
const ACTION_GUIDE = {
  all: 'Turns on every action this row offers. A shortcut, not a separate power - it holds nothing the individual switches do not.',
  view: 'Read and list these records, and see the matching item in the sidebar. Without it the screen is unreachable from the UI even when other switches are on.',
  create: 'Add new records. Does not imply the right to edit them afterwards.',
  edit: 'Change existing records.',
  delete: 'Remove records. Most collections keep a recoverable copy rather than erasing the row.',
  assign: 'Grant this role to other users - the step that actually hands out access. Deliberately separate from Edit: renaming a role and handing it to somebody are very different decisions.',
  revoke: 'End other people\'s active sessions, forcing them to sign in again.',
  'reset-password': 'Set another user\'s password without knowing the current one.',
  export: 'Download the whole dataset as a file. Worth treating as more sensitive than View: it turns a screen you can look at into a copy you can take away.'
};

const TEXT_COLUMNS = [
  { key: 'group', label: 'Group', width: '11rem' },
  { key: 'menu', label: 'Menu', width: '15rem' },
  { key: 'type', label: 'Type', width: '9rem' },
  { key: 'path', label: 'Path', width: '13rem' },
  { key: 'source', label: 'Source', width: '7.5rem' }
];

/**
 * Derived from the whole catalogue rather than the visible rows: columns that
 * appear and disappear as you type in the filter make the grid unreadable.
 */
const actionColumns = computed(() => {
  const declared = new Set();
  for (const row of rows.value) for (const action of row.actions) declared.add(action);

  return Array.from(declared)
    .sort((a, b) => actionRank(a) - actionRank(b) || a.localeCompare(b))
    .map((action, index) => ({
      key: `action:${action}`,
      action,
      label: humanise(action),
      accent: ACTION_ACCENT[action] || FALLBACK_ACCENTS[index % FALLBACK_ACCENTS.length]
    }));
});

function actionRank(action) {
  const index = ACTION_ORDER.indexOf(action);
  return index === -1 ? ACTION_ORDER.length : index;
}

function humanise(action) {
  return action.replace(/-/g, ' ').replace(/^./, (character) => character.toUpperCase());
}

const typeOptions = computed(() => catalogue.value.map((group) => group.group));

/**
 * The legend, built from the columns actually on screen rather than from a
 * fixed list - a module that introduces a new action documents itself here
 * with no change to this file.
 */
const actionGuide = computed(() => [
  { key: 'all', label: 'All', accent: '#6366f1', description: ACTION_GUIDE.all },
  ...actionColumns.value.map((column) => ({
    key: column.action,
    label: column.label,
    accent: column.accent,
    description: ACTION_GUIDE[column.action] || `Grants the "${column.action}" action on the resources that declare it.`
  }))
]);

const guideOpen = ref(true);

/** How many rows actually offer a given action - explains the dashes. */
function availabilityFor(action) {
  return rows.value.filter((row) => row.actions.includes(action)).length;
}

/* --- Selection and grant state ---------------------------------------------- */

const selectedRole = computed(() => roles.value.find((role) => role.id === selectedRoleId.value) || null);

/** No role selected: the grid describes the catalogue, not anyone's access. */
const catalogueOnly = computed(() => !selectedRole.value);

const isSuperAdminRole = computed(() => Boolean(selectedRole.value?.isSuperAdmin));

const canEdit = computed(
  () => Boolean(selectedRole.value) && !isSuperAdminRole.value && platform.can('/security/roles', 'edit')
);

const groupLabel = computed(() => selectedRole.value?.name || 'Declared permissions');

function resetDraft() {
  const map = {};
  // Seeded from every grant the role holds, not only the ones the catalogue
  // still lists - otherwise saving would silently drop grants belonging to a
  // module that happens to be unloaded right now.
  for (const grant of selectedRole.value?.grants || []) map[grant.resource] = new Set(grant.actions || []);

  baseline.value = map;
  draft.value = cloneGrants(map);
}

function cloneGrants(source) {
  const copy = {};
  for (const [resource, actions] of Object.entries(source)) copy[resource] = new Set(actions);
  return copy;
}

function granted(resource, action) {
  return draft.value[resource]?.has(action) || false;
}

/** 'absent' | 'declared' | 'on' | 'off' */
function cellState(row, action) {
  if (!row.actions.includes(action)) return 'absent';
  if (catalogueOnly.value) return 'declared';
  return granted(row.resource, action) ? 'on' : 'off';
}

/** 'declared' | 'on' | 'partial' | 'off' - drives the "All" column. */
function rowState(row) {
  if (catalogueOnly.value) return 'declared';

  const held = row.actions.filter((action) => granted(row.resource, action)).length;
  if (!held) return 'off';
  return held === row.actions.length ? 'on' : 'partial';
}

function toggleAction(row, action) {
  if (!canEdit.value) return;

  const next = { ...draft.value };
  const actions = new Set(next[row.resource] || []);

  if (actions.has(action)) actions.delete(action);
  else actions.add(action);

  if (actions.size) next[row.resource] = actions;
  else delete next[row.resource];

  draft.value = next;
}

function toggleRow(row) {
  if (!canEdit.value) return;

  const next = { ...draft.value };
  // Partial counts as "not yet all": one more click fills the row.
  if (rowState(row) === 'on') delete next[row.resource];
  else next[row.resource] = new Set(row.actions);

  draft.value = next;
}

/* --- Saving ----------------------------------------------------------------- */

const dirtyCount = computed(() => {
  const resources = new Set([...Object.keys(baseline.value), ...Object.keys(draft.value)]);

  let changes = 0;
  for (const resource of resources) {
    const before = baseline.value[resource] || new Set();
    const after = draft.value[resource] || new Set();
    for (const action of new Set([...before, ...after])) {
      if (before.has(action) !== after.has(action)) changes += 1;
    }
  }
  return changes;
});

async function save() {
  if (!selectedRole.value || !dirtyCount.value) return;

  saving.value = true;
  notice.value = '';
  error.value = '';

  try {
    const grants = Object.entries(draft.value)
      .filter(([, actions]) => actions.size)
      .map(([resource, actions]) => ({ resource, actions: Array.from(actions) }));

    const updated = await api.patch(`/roles/${selectedRole.value.id}`, { grants });

    // Mirror the saved role locally so switching away and back shows the new
    // state without another round trip.
    const index = roles.value.findIndex((role) => role.id === selectedRole.value.id);
    if (index !== -1) roles.value[index] = { ...roles.value[index], ...updated };

    resetDraft();
    lastLoadedAt.value = new Date();
    notice.value = 'Grants saved. Everyone holding this role must sign in again.';
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}

function discard() {
  resetDraft();
  notice.value = '';
}

/* --- Filtering, sorting, paging --------------------------------------------- */

const filteredRows = computed(() => {
  const term = filter.value.trim().toLowerCase();

  return rows.value.filter((row) => {
    if (typeFilter.value && row.type !== typeFilter.value) return false;
    if (!term) return true;

    return (
      row.menu.toLowerCase().includes(term) ||
      row.resource.toLowerCase().includes(term) ||
      row.type.toLowerCase().includes(term) ||
      (row.description || '').toLowerCase().includes(term) ||
      row.actions.some((action) => action.includes(term))
    );
  });
});

const sortedRows = computed(() => {
  const { key, direction } = sort.value;
  const factor = direction === 'asc' ? 1 : -1;
  return [...filteredRows.value].sort((a, b) => factor * compareRows(a, b, key) || a.menu.localeCompare(b.menu));
});

function compareRows(a, b, key) {
  if (key === 'all') return stateRank(rowState(a)) - stateRank(rowState(b));

  if (key.startsWith('action:')) {
    const action = key.slice('action:'.length);
    return Number(granted(a.resource, action)) - Number(granted(b.resource, action));
  }

  if (key === 'source') return Number(a.dangerous) - Number(b.dangerous);
  if (key === 'path') return a.resource.localeCompare(b.resource);
  if (key === 'type') return a.type.localeCompare(b.type);
  if (key === 'menu') return a.menu.localeCompare(b.menu);
  return 0;
}

function stateRank(state) {
  return { off: 0, partial: 1, on: 2, declared: 2 }[state] ?? 0;
}

function toggleSort(key) {
  sort.value =
    sort.value.key === key
      ? { key, direction: sort.value.direction === 'asc' ? 'desc' : 'asc' }
      : { key, direction: 'asc' };
}

function sortIndicator(key) {
  if (sort.value.key !== key) return '↕';
  return sort.value.direction === 'asc' ? '↑' : '↓';
}

const totalPages = computed(() => {
  if (!pageSize.value) return 1;
  return Math.max(1, Math.ceil(sortedRows.value.length / pageSize.value));
});

const pagedRows = computed(() => {
  if (!pageSize.value) return sortedRows.value;
  const start = (page.value - 1) * pageSize.value;
  return sortedRows.value.slice(start, start + pageSize.value);
});

const pageRange = computed(() => {
  const total = sortedRows.value.length;
  if (!total) return { start: 0, end: 0, total: 0 };
  if (!pageSize.value) return { start: 1, end: total, total };

  return {
    start: (page.value - 1) * pageSize.value + 1,
    end: Math.min(page.value * pageSize.value, total),
    total
  };
});

watch([filter, typeFilter, pageSize], () => {
  page.value = 1;
});

// A filter that empties the last page would otherwise leave it stranded.
watch(totalPages, (pages) => {
  if (page.value > pages) page.value = pages;
});

/**
 * Switching group discards staged edits, so it asks first. The flag stops the
 * revert from re-entering the watcher and prompting a second time.
 */
let revertingSelection = false;

watch(selectedRoleId, (next, previous) => {
  if (revertingSelection) {
    revertingSelection = false;
    return;
  }

  if (dirtyCount.value && !window.confirm('Discard unsaved permission changes?')) {
    revertingSelection = true;
    selectedRoleId.value = previous;
    return;
  }

  notice.value = '';
  resetDraft();

  // Keeps the URL shareable: a colleague opening the link lands on the same
  // group rather than on whichever role happens to sort first. Written as a
  // path so any legacy `?group=<id>` is dropped rather than left contradicting
  // the segment.
  const code = selectedRole.value?.code;
  router.replace(code ? `/security/permissions/${code}` : '/security/permissions');
});

/* --- Presentation ----------------------------------------------------------- */

const stats = computed(() => ({
  groups: catalogue.value.length,
  resources: rows.value.length,
  rules: rows.value.reduce((total, row) => total + row.actions.length, 0),
  granted: Object.values(draft.value).reduce((total, actions) => total + actions.size, 0)
}));

const lastUpdatedLabel = computed(() => formatDateTime(lastLoadedAt.value));

const PAGE_SIZES = [10, 20, 50, 100, 0];
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-header__title">Permission matrix</h1>
        <p class="page-header__meta">Last updated {{ lastUpdatedLabel }}</p>
        <p class="page-header__description">
          Review group-to-resource rules, tune access switches, and keep the permission grid under control.
        </p>
      </div>

      <button type="button" class="btn btn--ghost" :disabled="loading || saving" @click="refresh">
        {{ loading ? 'Refreshing…' : 'Refresh' }}
      </button>
    </header>

    <section class="kpis" aria-label="Catalogue totals">
      <div class="card kpi">
        <span class="kpi__bar" style="background: #6366f1" aria-hidden="true" />
        <span class="kpi__label">Groups</span>
        <span class="kpi__value">{{ stats.groups }}</span>
      </div>

      <div class="card kpi">
        <span class="kpi__bar" style="background: #0ea5e9" aria-hidden="true" />
        <span class="kpi__label">Resources</span>
        <span class="kpi__value">{{ stats.resources }}</span>
      </div>

      <div class="card kpi">
        <span class="kpi__bar" style="background: #f59e0b" aria-hidden="true" />
        <span class="kpi__label">Rules</span>
        <span class="kpi__value">{{ stats.rules }}</span>
      </div>

      <div v-if="!catalogueOnly" class="card kpi">
        <span class="kpi__bar" style="background: #10b981" aria-hidden="true" />
        <span class="kpi__label">Granted</span>
        <span class="kpi__value">{{ stats.granted }}</span>
      </div>
    </section>

    <p v-if="error" class="alert alert--danger" role="alert">{{ error }}</p>
    <p v-if="notice" class="alert alert--info">{{ notice }}</p>

    <p v-if="isSuperAdminRole" class="alert alert--warning">
      A super-admin role bypasses grant checks entirely, so its switches are shown for reference only.
    </p>

    <section class="card guide">
      <header class="guide__header">
        <h2 class="guide__title">What each switch grants</h2>
        <button type="button" class="guide__toggle" :aria-expanded="guideOpen" @click="guideOpen = !guideOpen">
          {{ guideOpen ? 'Hide' : 'Show' }}
        </button>
      </header>

      <template v-if="guideOpen">
        <ul class="guide__list">
          <li v-for="entry in actionGuide" :key="entry.key" class="guide__item">
            <span class="guide__mark" :style="{ background: entry.accent }" aria-hidden="true" />
            <div>
              <p class="guide__name">
                {{ entry.label }}
                <span v-if="entry.key !== 'all'" class="guide__count">
                  {{ availabilityFor(entry.key) }} of {{ rows.length }} resources
                </span>
              </p>
              <p class="guide__description">{{ entry.description }}</p>
            </div>
          </li>
        </ul>

        <!-- The dashes read as "the UI is holding something back" unless this
             is said out loud, which is exactly how it looked before. -->
        <p class="guide__note">
          A greyed-out switch means <strong>no code in this system checks that action</strong> on that resource - there
          is no endpoint behind it, so switching it on would grant nothing and the API rejects it on save. Columns come
          from the modules themselves: declare the action in that module's
          <code>module.manifest.js</code> and the switch becomes live everywhere it applies, with no change to this
          screen.
        </p>
      </template>
    </section>

    <section class="card grid">
      <header class="grid__header">
        <h2 class="grid__title">
          <span class="grid__title-mark" aria-hidden="true"></span>
          Permission table
        </h2>

        <div class="grid__selects">
          <label class="field">
            <span class="field__label">Group</span>
            <select v-model="selectedRoleId" class="field__control">
              <option value="">Declared permissions (no group)</option>
              <option v-for="role in roles" :key="role.id" :value="role.id">
                {{ role.name }} · {{ role.code }}
              </option>
            </select>
          </label>

          <label class="field">
            <span class="sr-only">Type</span>
            <select v-model="typeFilter" class="field__control">
              <option value="">All types</option>
              <option v-for="type in typeOptions" :key="type" :value="type">{{ type }}</option>
            </select>
          </label>
        </div>
      </header>

      <div class="grid__toolbar">
        <label class="field field--inline">
          <span class="field__label">Filter</span>
          <input v-model="filter" type="search" class="field__control" placeholder="type string…" />
        </label>

        <label class="field field--inline grid__page-size">
          <span class="field__label">Items per page</span>
          <select v-model.number="pageSize" class="field__control">
            <option v-for="size in PAGE_SIZES" :key="size" :value="size">{{ size || 'All' }}</option>
          </select>
        </label>
      </div>

      <p v-if="catalogueOnly" class="grid__hint">
        No group selected: the switches show what each resource declares. Pick a group to see - and change - who
        holds it.
      </p>
      <!-- The super-admin case has its own banner above; repeating "you need
           roles:edit" there was simply wrong - the viewer usually holds it, and
           the reason it is read-only is that grants do not apply to that role. -->
      <p v-else-if="isSuperAdminRole" class="grid__hint">
        Read-only: this role already bypasses every check below.
      </p>
      <p v-else-if="!canEdit" class="grid__hint">
        Read-only: changing grants needs <code>/security/roles:edit</code>.
      </p>

      <div class="table-scroll">
        <table class="table matrix">
          <thead>
            <tr>
              <th
                v-for="column in TEXT_COLUMNS"
                :key="column.key"
                :style="{ width: column.width }"
                :aria-sort="sort.key === column.key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'"
              >
                <button type="button" class="matrix__sort" @click="toggleSort(column.key)">
                  {{ column.label }}
                  <span class="matrix__arrow" :class="{ 'matrix__arrow--active': sort.key === column.key }" aria-hidden="true">
                    {{ sortIndicator(column.key) }}
                  </span>
                </button>
              </th>

              <th class="matrix__switch-head">
                <button type="button" class="matrix__sort" @click="toggleSort('all')">
                  All
                  <span class="matrix__arrow" :class="{ 'matrix__arrow--active': sort.key === 'all' }" aria-hidden="true">
                    {{ sortIndicator('all') }}
                  </span>
                </button>
              </th>

              <th v-for="column in actionColumns" :key="column.key" class="matrix__switch-head">
                <button type="button" class="matrix__sort" @click="toggleSort(column.key)">
                  {{ column.label }}
                  <span class="matrix__arrow" :class="{ 'matrix__arrow--active': sort.key === column.key }" aria-hidden="true">
                    {{ sortIndicator(column.key) }}
                  </span>
                </button>
              </th>
            </tr>
          </thead>

          <tbody>
            <tr v-if="loading">
              <td :colspan="TEXT_COLUMNS.length + actionColumns.length + 1" class="matrix__state">Loading…</td>
            </tr>

            <tr v-else-if="!pagedRows.length">
              <td :colspan="TEXT_COLUMNS.length + actionColumns.length + 1" class="matrix__state">
                No permissions match this filter.
              </td>
            </tr>

            <tr v-for="row in pagedRows" v-else :key="row.resource" class="matrix__row">
              <td class="matrix__group">{{ groupLabel }}</td>

              <td>
                <span class="matrix__menu">{{ row.menu }}</span>
                <span class="matrix__description">{{ row.description }}</span>
              </td>

              <td><span class="matrix__type">{{ row.type }}</span></td>

              <td><code class="matrix__path">{{ row.resource }}</code></td>

              <td>
                <span class="badge" :class="row.dangerous ? 'badge--danger' : 'badge--success'">
                  {{ row.dangerous ? 'Sensitive' : 'Manifest' }}
                </span>
              </td>

              <td class="matrix__switch-cell">
                <label class="switch switch--all">
                  <input
                    type="checkbox"
                    role="switch"
                    class="switch__input"
                    :checked="rowState(row) === 'on' || rowState(row) === 'declared'"
                    :indeterminate="rowState(row) === 'partial'"
                    :disabled="!canEdit"
                    :aria-label="`${row.menu}: every action`"
                    @change="toggleRow(row)"
                  />
                  <span class="switch__track" aria-hidden="true"></span>
                </label>
              </td>

              <!-- A switch in every cell, including the inert ones. A bare dash
                   looked like the UI was withholding a control; a disabled
                   switch that says why it is disabled reads as a fact about the
                   system instead. -->
              <td v-for="column in actionColumns" :key="column.key" class="matrix__switch-cell">
                <label
                  class="switch"
                  :class="{ 'switch--unavailable': cellState(row, column.action) === 'absent' }"
                  :style="{ '--switch-accent': column.accent }"
                  :title="
                    cellState(row, column.action) === 'absent'
                      ? `Nothing in this system checks ${row.resource}:${column.action} - declare it in the module manifest to make it grantable.`
                      : `${row.menu}: ${column.label}`
                  "
                >
                  <input
                    type="checkbox"
                    role="switch"
                    class="switch__input"
                    :checked="cellState(row, column.action) === 'on' || cellState(row, column.action) === 'declared'"
                    :disabled="!canEdit || cellState(row, column.action) === 'absent'"
                    :aria-label="`${row.menu}: ${column.label}`"
                    @change="toggleAction(row, column.action)"
                  />
                  <span class="switch__track" aria-hidden="true"></span>
                </label>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <footer class="grid__footer">
        <span class="grid__range">
          <template v-if="pageRange.total">{{ pageRange.start }}–{{ pageRange.end }} of {{ pageRange.total }}</template>
          <template v-else>No rows</template>
        </span>

        <template v-if="totalPages > 1">
          <button type="button" class="btn btn--ghost" :disabled="page <= 1" @click="page -= 1">Previous</button>
          <span class="grid__page">{{ page }} / {{ totalPages }}</span>
          <button type="button" class="btn btn--ghost" :disabled="page >= totalPages" @click="page += 1">Next</button>
        </template>
      </footer>
    </section>

    <!-- Only appears once something is staged, so the grid is never covered
         while the user is only reading. -->
    <div v-if="dirtyCount" class="save-bar">
      <span class="save-bar__count">{{ dirtyCount }} pending change{{ dirtyCount === 1 ? '' : 's' }}</span>
      <button type="button" class="btn btn--ghost" :disabled="saving" @click="discard">Discard</button>
      <button type="button" class="btn btn--primary" :disabled="saving" @click="save">
        {{ saving ? 'Saving…' : 'Save changes' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.page {
  padding-bottom: 1rem;
}

/* --- KPI tiles --------------------------------------------------------------
   The dashboard's convention: a thin coloured edge rather than a tinted
   circular icon, because the edge reads the same on a white and a black
   surface while a tinted disc washes out on one of them.
   ------------------------------------------------------------------------- */

.kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  gap: 1rem;
  margin-bottom: 1.25rem;
}

.kpi {
  position: relative;
  display: block;
  padding: var(--space-4) var(--space-6);
  overflow: hidden;
}

.kpi__bar {
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
}

.kpi__label {
  display: block;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.kpi__value {
  display: block;
  margin-top: 0.25rem;
  font-size: 1.75rem;
  font-weight: 700;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

/* --- Grid card -------------------------------------------------------------- */

.grid {
  padding: var(--space-4) var(--space-6) var(--space-4);
}

.grid__header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1rem;
  padding-bottom: 0.875rem;
  border-bottom: 1px solid var(--color-border);
}

.grid__title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  font-size: 1.0625rem;
  font-weight: 700;
}

.grid__title-mark {
  width: 0.25rem;
  height: 1.125rem;
  border-radius: var(--radius-full);
  background: var(--color-primary);
}

.grid__selects {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-left: auto;
}

.grid__toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
  padding: 0.875rem 0;
}

.grid__page-size {
  margin-left: auto;
}

.field {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.field__label {
  font-size: 0.8125rem;
  color: var(--color-text-muted);
  white-space: nowrap;
}

.field__control {
  padding: 0.4375rem 0.625rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  font-size: 0.875rem;
}

.field--inline .field__control {
  min-width: 12rem;
}

.grid__page-size .field__control {
  min-width: 5rem;
}

.grid__hint {
  margin: 0 0 0.75rem;
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}

.grid__hint code {
  font-family: var(--font-mono);
  font-size: 0.75rem;
}

.grid__footer {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding-top: 0.875rem;
}

.grid__range {
  margin-right: auto;
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}

.grid__page {
  font-size: 0.875rem;
}

/* --- Table ------------------------------------------------------------------ */

.matrix {
  min-width: 60rem;
}

.matrix__sort {
  display: inline-flex;
  align-items: center;
  gap: 0.3125rem;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  cursor: pointer;
  white-space: nowrap;
}

.matrix__arrow {
  opacity: 0.35;
  font-size: 0.6875rem;
}

.matrix__arrow--active {
  opacity: 1;
  color: var(--color-primary);
}

.matrix__switch-head {
  text-align: center;
}

.matrix__switch-head .matrix__sort {
  justify-content: center;
}

.matrix__row:hover {
  background: var(--color-surface-hover);
}

.matrix__group {
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}

.matrix__menu {
  display: block;
  font-weight: 600;
}

.matrix__description {
  display: block;
  margin-top: 0.125rem;
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}

.matrix__type {
  font-size: 0.8125rem;
}

.matrix__path {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.matrix__switch-cell {
  text-align: center;
  white-space: nowrap;
}

/* --- Action guide ----------------------------------------------------------- */

.guide {
  padding: var(--space-4) var(--space-6);
  margin-bottom: 1.25rem;
}

.guide__header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.guide__title {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
}

.guide__toggle {
  margin-left: auto;
  padding: 0.25rem 0.625rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: none;
  color: var(--color-text-muted);
  font: inherit;
  font-size: 0.8125rem;
  cursor: pointer;
}

.guide__toggle:hover {
  background: var(--color-surface-hover);
  color: var(--color-text);
}

.guide__list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(19rem, 1fr));
  gap: 0.875rem 1.5rem;
  margin: 1rem 0 0;
  padding: 0;
  list-style: none;
}

.guide__item {
  display: flex;
  gap: 0.625rem;
}

.guide__mark {
  flex: none;
  width: 0.25rem;
  border-radius: var(--radius-full);
}

.guide__name {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.5rem;
  margin: 0;
  font-size: 0.875rem;
  font-weight: 700;
}

.guide__count {
  font-size: 0.6875rem;
  font-weight: 500;
  color: var(--color-text-muted);
}

.guide__description {
  margin: 0.125rem 0 0;
  font-size: 0.8125rem;
  line-height: 1.5;
  color: var(--color-text-muted);
}

.guide__note {
  margin: 1.25rem 0 0;
  padding-top: 0.875rem;
  border-top: 1px solid var(--color-border);
  font-size: 0.8125rem;
  line-height: 1.6;
  color: var(--color-text-muted);
}

.guide__note code {
  font-family: var(--font-mono);
  font-size: 0.75rem;
}

.matrix__state {
  padding: 2.5rem;
  text-align: center;
  color: var(--color-text-muted);
}

.badge {
  display: inline-block;
  padding: 0.125rem 0.5rem;
  border-radius: var(--radius-sm);
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.badge--success {
  background: color-mix(in srgb, var(--color-success) 15%, transparent);
  color: var(--color-success);
}

.badge--danger {
  background: color-mix(in srgb, var(--color-danger) 15%, transparent);
  color: var(--color-danger);
}

/* --- Switches --------------------------------------------------------------- */

.switch {
  --switch-accent: var(--color-primary);
  position: relative;
  display: inline-flex;
  vertical-align: middle;
}

.switch--all {
  --switch-accent: #6366f1;
}

/* The input stays in the DOM and keeps focus and screen-reader semantics; the
   track is what the user actually sees. */
.switch__input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}

.switch__input:disabled {
  cursor: default;
}

.switch__track {
  display: block;
  position: relative;
  width: 2.5rem;
  height: 1.375rem;
  border: 1px solid color-mix(in srgb, var(--color-text) 14%, transparent);
  border-radius: var(--radius-full);
  background: var(--color-surface-hover);
  transition: background-color 0.15s ease, border-color 0.15s ease;
}

.switch__track::after {
  content: '';
  position: absolute;
  top: 0.1875rem;
  left: 0.1875rem;
  width: 0.875rem;
  height: 0.875rem;
  border-radius: var(--radius-full);
  background: #fff;
  box-shadow: 0 1px 3px rgb(0 0 0 / 25%);
  transition: transform 0.15s ease;
}

.switch__input:checked + .switch__track {
  border-color: transparent;
  background: var(--switch-accent);
}

.switch__input:checked + .switch__track::after {
  transform: translateX(1.0625rem);
}

.switch__input:indeterminate + .switch__track {
  border-color: transparent;
  background: color-mix(in srgb, var(--switch-accent) 45%, var(--color-border));
}

.switch__input:indeterminate + .switch__track::after {
  transform: translateX(0.53125rem);
}

.switch__input:focus-visible + .switch__track {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.switch__input:disabled + .switch__track {
  opacity: 0.55;
}

/* Inert because no code checks the action, as opposed to inert because the
   viewer may not edit. Dashed and flatter, so the two read differently at a
   glance instead of looking like the same "not allowed". */
.switch--unavailable .switch__track {
  border-style: dashed;
  background: none;
  opacity: 0.4;
}

.switch--unavailable .switch__track::after {
  background: var(--color-text-muted);
  box-shadow: none;
  opacity: 0.5;
}

.switch--unavailable .switch__input {
  cursor: not-allowed;
}

/* --- Alerts and save bar ---------------------------------------------------- */

.alert {
  padding: 0.625rem 0.875rem;
  margin-bottom: 1rem;
  border-radius: var(--radius-md);
  font-size: 0.875rem;
}

.alert--info {
  background: color-mix(in srgb, var(--color-info) 12%, transparent);
  color: var(--color-info);
}

.alert--warning {
  background: color-mix(in srgb, var(--color-warning) 12%, transparent);
  color: var(--color-warning);
}

.alert--danger {
  background: color-mix(in srgb, var(--color-danger) 12%, transparent);
  color: var(--color-danger);
}

.save-bar {
  position: sticky;
  bottom: 1rem;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-top: 1rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  box-shadow: var(--shadow-lg);
}

.save-bar__count {
  margin-right: auto;
  font-size: 0.875rem;
  font-weight: 600;
}

@media (max-width: 48rem) {
  /* The header needs no override: `.page-header` already wraps, and the
     refresh button's `margin-left: auto` stops applying once it does. */
  .grid__selects,
  .grid__page-size {
    margin-left: 0;
  }
}
</style>
