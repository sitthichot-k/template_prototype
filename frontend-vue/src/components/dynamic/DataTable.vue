<script setup>
/**
 * Generic list table.
 *
 * Pairs with the backend's shared list-query contract
 * (`?page=&limit=&sort=&q=&filter[x]=`), so any collection endpoint gets
 * paging, sorting and search without per-resource code. A screen supplies
 * columns and an endpoint; everything else is handled here.
 */

import { computed, ref, useSlots, watch } from 'vue';
import api from '@/services/api';

const props = defineProps({
  /** API path, e.g. '/users' */
  endpoint: { type: String, required: true },
  /** `[{ key, label, sortable, formatter, width }]` */
  columns: { type: Array, required: true },
  /** Non-negotiable server-side filters. */
  baseParams: { type: Object, default: () => ({}) },
  searchable: { type: Boolean, default: true },
  defaultSort: { type: String, default: '-createdAt' },
  pageSize: { type: Number, default: 25 },
  rowKey: { type: String, default: 'id' }
});

const emit = defineEmits(['row-click']);

const items = ref([]);
const meta = ref({ page: 1, limit: props.pageSize, total: 0, totalPages: 0 });
const loading = ref(false);
const error = ref('');

const page = ref(1);
const sort = ref(props.defaultSort);
const search = ref('');

let searchTimer = null;

async function load() {
  loading.value = true;
  error.value = '';

  try {
    const result = await api.list(props.endpoint, {
      page: page.value,
      limit: props.pageSize,
      sort: sort.value,
      q: search.value || undefined,
      ...props.baseParams
    });
    items.value = result.items;
    meta.value = result.meta.pagination;
  } catch (err) {
    error.value = err.message;
    items.value = [];
  } finally {
    loading.value = false;
  }
}

function toggleSort(column) {
  if (!column.sortable) return;
  // Cycles ascending -> descending on repeat clicks of the same column.
  sort.value = sort.value === column.key ? `-${column.key}` : column.key;
}

function sortIndicator(column) {
  if (!column.sortable) return '';
  if (sort.value === column.key) return '▲';
  if (sort.value === `-${column.key}`) return '▼';
  return '';
}

function cellValue(row, column) {
  const raw = column.key.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), row);
  return column.formatter ? column.formatter(raw, row) : raw;
}

/** Placeholder rows must span the actions column only when there is one. */
const slots = useSlots();
const columnCount = computed(() => props.columns.length + (slots['row-actions'] ? 1 : 0));

const pageRange = computed(() => {
  const start = meta.value.total === 0 ? 0 : (meta.value.page - 1) * meta.value.limit + 1;
  const end = Math.min(meta.value.page * meta.value.limit, meta.value.total);
  return { start, end };
});

// A search box that fires a request per keystroke is a denial-of-service
// against your own API.
watch(search, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    page.value = 1;
    load();
  }, 300);
});

watch([page, sort, () => props.baseParams], load, { immediate: true, deep: true });

defineExpose({ reload: load });
</script>

<template>
  <div class="data-table">
    <header v-if="searchable || $slots.actions" class="data-table__toolbar">
      <input
        v-if="searchable"
        v-model="search"
        type="search"
        class="data-table__search"
        placeholder="Search…"
        aria-label="Search"
      />
      <div class="data-table__actions">
        <slot name="actions" />
      </div>
    </header>

    <p v-if="error" class="data-table__error" role="alert">{{ error }}</p>

    <div class="table-scroll">
      <table class="table">
        <thead>
          <tr>
            <th
              v-for="column in columns"
              :key="column.key"
              :style="column.width ? { width: column.width } : undefined"
              :aria-sort="sortIndicator(column) ? 'other' : undefined"
            >
              <button
                v-if="column.sortable"
                type="button"
                class="data-table__sort"
                @click="toggleSort(column)"
              >
                {{ column.label }} <span aria-hidden="true">{{ sortIndicator(column) }}</span>
              </button>
              <template v-else>{{ column.label }}</template>
            </th>
            <!-- Bracket notation is required: `$slots.row-actions` compiles to
                 the subtraction `$slots.row - actions`, which is NaN, so the
                 header silently never rendered while the body cell did - one
                 column short, misaligning every row.

                 The label is for screen readers only. Visible, it says nothing
                 a row of buttons does not already say, it costs a column of
                 width, and it collides with any resource that has a data
                 column of its own called "Actions" - which policies do. -->
            <th v-if="$slots['row-actions']" class="data-table__actions-header">
              <span class="sr-only">Actions</span>
            </th>
          </tr>
        </thead>

        <tbody>
          <tr v-if="loading">
            <td :colspan="columnCount" class="data-table__state">Loading…</td>
          </tr>

          <tr v-else-if="!items.length">
            <td :colspan="columnCount" class="data-table__state">No records found.</td>
          </tr>

          <tr
            v-for="row in items"
            v-else
            :key="row[rowKey]"
            class="data-table__row"
            @click="emit('row-click', row)"
          >
            <td v-for="column in columns" :key="column.key">
              <slot :name="`cell-${column.key}`" :row="row" :value="cellValue(row, column)">
                {{ cellValue(row, column) }}
              </slot>
            </td>
            <td v-if="$slots['row-actions']" class="data-table__row-actions" @click.stop>
              <slot name="row-actions" :row="row" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer v-if="meta.totalPages > 1" class="data-table__pagination">
      <span class="data-table__range">
        {{ pageRange.start }}–{{ pageRange.end }} of {{ meta.total }}
      </span>

      <button type="button" class="btn btn--ghost" :disabled="page <= 1" @click="page -= 1">
        Previous
      </button>
      <span class="data-table__page">{{ meta.page }} / {{ meta.totalPages }}</span>
      <button
        type="button"
        class="btn btn--ghost"
        :disabled="page >= meta.totalPages"
        @click="page += 1"
      >
        Next
      </button>
    </footer>
  </div>
</template>

<style scoped>
.data-table__toolbar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.data-table__search {
  flex: 0 1 20rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
}

.data-table__actions {
  margin-left: auto;
  display: flex;
  gap: 0.5rem;
}

.data-table__sort {
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
}

/* `width: 1%` with nowrap is the shrink-to-fit idiom for a table cell: the
   browser gives the column its content width and hands the slack to the data
   columns, instead of splitting the table evenly and stranding the buttons far
   from the row they act on. */
.data-table__actions-header,
.data-table__row-actions {
  width: 1%;
  white-space: nowrap;
  text-align: right;
}

.data-table__row {
  cursor: pointer;
}

.data-table__row:hover {
  background: var(--color-surface-hover);
}

.data-table__state {
  padding: 2rem;
  text-align: center;
  color: var(--color-text-muted);
}

.data-table__error {
  padding: 0.625rem 0.875rem;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-danger) 12%, transparent);
  color: var(--color-danger);
  font-size: 0.875rem;
}

.data-table__pagination {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding-top: 1rem;
}

.data-table__range {
  margin-right: auto;
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}

.data-table__page {
  font-size: 0.875rem;
}
</style>
