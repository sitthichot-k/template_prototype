<script setup>
/**
 * Application log viewer.
 *
 * The point of this screen is to answer "what just went wrong" without an SSH
 * session. Three things follow from that:
 *
 *   - the level counts double as filters, because the first move is always
 *     "show me the errors";
 *   - a row expands to its full context and metadata rather than linking to a
 *     detail page, so scanning a sequence of related events stays in one place;
 *   - the request id is surfaced, because it is what ties a browser complaint
 *     to a server row.
 */

import { computed, onMounted, ref, watch } from 'vue';
import api from '@/services/api';

import { formatDateTime } from '@/composables/useFormat';
const items = ref([]);
const summary = ref(null);
const total = ref(0);
const loading = ref(true);
const error = ref('');

const level = ref('');
const search = ref('');
const windowHours = ref(24);
const pageSize = ref(25);
const page = ref(1);

const expanded = ref(new Set());

/**
 * Matches the stored log's levels exactly.
 *
 * A "Debug" tile and filter used to sit here as well. Nothing can write a
 * debug row - the level does not exist in this collection, by design - so the
 * tile read 0 for ever and the filter always answered "Nothing was logged in
 * this window", which looked like a broken screen next to a container log full
 * of DEBUG lines. Debug output is the process stream, not this.
 */
const LEVELS = [
  { value: 'error', label: 'Error', accent: 'var(--color-danger)' },
  { value: 'warn', label: 'Warning', accent: 'var(--color-warning)' },
  { value: 'info', label: 'Info', accent: 'var(--color-info)' }
];

const WINDOWS = [
  { value: 1, label: 'Last hour' },
  { value: 24, label: 'Last 24 hours' },
  { value: 168, label: 'Last 7 days' },
  { value: 720, label: 'Last 30 days' }
];

const PAGE_SIZES = [25, 50, 100, 200];

onMounted(load);

async function load() {
  loading.value = true;
  error.value = '';

  try {
    const from = new Date(Date.now() - windowHours.value * 3600 * 1000).toISOString();

    const [listResult, summaryResult] = await Promise.all([
      api.list('/logs', {
        page: page.value,
        limit: pageSize.value,
        level: level.value || undefined,
        q: search.value.trim() || undefined,
        from
      }),
      // The header counts describe the window, not the page, so they are a
      // separate call rather than something derived from the rows on screen.
      api.get('/logs/summary', { params: { hours: windowHours.value } })
    ]);

    items.value = listResult.items;
    total.value = listResult.meta?.pagination?.total ?? 0;
    summary.value = summaryResult;
    expanded.value = new Set();
  } catch (err) {
    error.value = err.message;
    items.value = [];
  } finally {
    loading.value = false;
  }
}

// A keystroke-per-request search is a denial of service against your own API.
let searchTimer = null;
watch(search, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    page.value = 1;
    load();
  }, 350);
});

watch([level, windowHours, pageSize], () => {
  page.value = 1;
  load();
});

watch(page, load);

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));

const pageRange = computed(() => {
  if (!total.value) return { start: 0, end: 0 };
  return {
    start: (page.value - 1) * pageSize.value + 1,
    end: Math.min(page.value * pageSize.value, total.value)
  };
});

function toggleLevel(value) {
  level.value = level.value === value ? '' : value;
}

function toggle(id) {
  const next = new Set(expanded.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expanded.value = next;
}

/** Rows with nothing extra to show must not look expandable. */
function hasDetail(entry) {
  return Boolean(Object.keys(entry.meta || {}).length || entry.context?.requestId);
}

function formatTime(value) {
  return formatDateTime(value);
}

function levelAccent(value) {
  return LEVELS.find((entry) => entry.value === value)?.accent || 'var(--color-text-muted)';
}
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-header__title">Logs</h1>
        <p class="page-header__description">
          Everything the platform recorded - requests, warnings and failures - newest first.
          Debug-level detail is not stored here; it goes to the server's own output stream.
        </p>
      </div>

      <button type="button" class="btn btn--ghost" :disabled="loading" @click="load">
        {{ loading ? 'Refreshing…' : 'Refresh' }}
      </button>
    </header>

    <section v-if="summary" class="levels" aria-label="Counts by level">
      <button
        v-for="entry in LEVELS"
        :key="entry.value"
        type="button"
        class="card level"
        :class="{ 'level--active': level === entry.value }"
        :style="{ '--level-accent': entry.accent }"
        :aria-pressed="level === entry.value"
        @click="toggleLevel(entry.value)"
      >
        <span class="level__dot" aria-hidden="true" />
        <span class="level__label">{{ entry.label }}</span>
        <span class="level__count">{{ (summary.byLevel[entry.value] || 0).toLocaleString() }}</span>
      </button>
    </section>

    <p v-if="summary?.topProblems?.length" class="problems">
      Most frequent problems:
      <button
        v-for="problem in summary.topProblems"
        :key="problem.action"
        type="button"
        class="problems__item"
        @click="search = problem.action"
      >
        {{ problem.action }} <span class="problems__count">{{ problem.count }}</span>
      </button>
    </p>

    <section class="card panel">
      <div class="toolbar">
        <input v-model="search" type="search" class="control control--grow" placeholder="Search message, action, actor or path…" />

        <select v-model="level" class="control" aria-label="Level">
          <option value="">All levels</option>
          <option v-for="entry in LEVELS" :key="entry.value" :value="entry.value">{{ entry.label }}</option>
        </select>

        <select v-model.number="windowHours" class="control" aria-label="Time window">
          <option v-for="entry in WINDOWS" :key="entry.value" :value="entry.value">{{ entry.label }}</option>
        </select>

        <select v-model.number="pageSize" class="control" aria-label="Rows per page">
          <option v-for="size in PAGE_SIZES" :key="size" :value="size">{{ size }} / page</option>
        </select>
      </div>

      <p v-if="error" class="alert alert--danger" role="alert">{{ error }}</p>

      <div class="table-scroll">
        <table class="table logs">
          <thead>
            <tr>
              <th style="width: 12rem">Time</th>
              <th style="width: 6rem">Level</th>
              <th style="width: 12rem">Action</th>
              <th style="width: 12rem">Actor</th>
              <th>Message</th>
              <th style="width: 6rem" class="numeric">Took</th>
            </tr>
          </thead>

          <tbody>
            <tr v-if="loading">
              <td colspan="6" class="state">Loading…</td>
            </tr>

            <tr v-else-if="!items.length">
              <td colspan="6" class="state">Nothing was logged in this window.</td>
            </tr>

            <template v-for="entry in items" v-else :key="entry.id">
              <tr
                class="logs__row"
                :class="{ 'logs__row--expandable': hasDetail(entry) }"
                @click="hasDetail(entry) && toggle(entry.id)"
              >
                <td class="nowrap muted">
                  <span v-if="hasDetail(entry)" class="chevron" aria-hidden="true">
                    {{ expanded.has(entry.id) ? '▾' : '▸' }}
                  </span>
                  {{ formatTime(entry.occurredAt) }}
                </td>

                <td>
                  <span class="badge" :style="{ '--level-accent': levelAccent(entry.level) }">{{ entry.level }}</span>
                </td>

                <td class="nowrap"><code>{{ entry.action }}</code></td>

                <td class="nowrap muted">{{ entry.actorLabel || '—' }}</td>

                <td class="message">
                  {{ entry.message }}
                  <span v-if="entry.context?.statusCode" class="status" :class="`status--${Math.floor(entry.context.statusCode / 100)}xx`">
                    {{ entry.context.statusCode }}
                  </span>
                </td>

                <td class="numeric muted nowrap">
                  {{ entry.context?.durationMs != null ? `${entry.context.durationMs}ms` : '—' }}
                </td>
              </tr>

              <tr v-if="expanded.has(entry.id)" class="logs__detail">
                <td colspan="6">
                  <dl class="context">
                    <template v-for="(value, key) in entry.context" :key="key">
                      <template v-if="value !== '' && value !== null">
                        <dt>{{ key }}</dt>
                        <dd>{{ value }}</dd>
                      </template>
                    </template>
                  </dl>

                  <pre v-if="Object.keys(entry.meta || {}).length" class="meta">{{ JSON.stringify(entry.meta, null, 2) }}</pre>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <footer class="footer">
        <span class="footer__range">
          <template v-if="total">{{ pageRange.start }}–{{ pageRange.end }} of {{ total.toLocaleString() }}</template>
          <template v-else>No entries</template>
        </span>

        <template v-if="totalPages > 1">
          <button type="button" class="btn btn--ghost" :disabled="page <= 1 || loading" @click="page -= 1">
            Previous
          </button>
          <span class="footer__page">{{ page }} / {{ totalPages }}</span>
          <button type="button" class="btn btn--ghost" :disabled="page >= totalPages || loading" @click="page += 1">
            Next
          </button>
        </template>
      </footer>
    </section>
  </div>
</template>

<style scoped>


/* --- Level chips ------------------------------------------------------------ */

.levels {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.level {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.level:hover {
  border-color: var(--color-border-strong);
}

.level--active {
  border-color: var(--level-accent);
  background: color-mix(in srgb, var(--level-accent) 8%, var(--color-surface));
}

.level__dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: var(--radius-full);
  background: var(--level-accent);
}

.level__label {
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}

.level__count {
  margin-left: auto;
  font-size: 1.125rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.problems {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.375rem;
  margin: 0 0 1rem;
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}

.problems__item {
  padding: 0.125rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  background: none;
  color: inherit;
  font: inherit;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  cursor: pointer;
}

.problems__item:hover {
  border-color: var(--color-border-strong);
  color: var(--color-text);
}

.problems__count {
  font-weight: 700;
  color: var(--color-warning);
}

/* --- Panel and toolbar ------------------------------------------------------ */

.panel {
  padding: var(--space-4) var(--space-6);
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.625rem;
  margin-bottom: 1rem;
}

.control {
  padding: 0.4375rem 0.625rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  font-size: 0.875rem;
}

.control--grow {
  flex: 1 1 18rem;
}

/* --- Table ------------------------------------------------------------------ */

.logs {
  min-width: 56rem;
}

.logs__row--expandable {
  cursor: pointer;
}

.logs__row:hover {
  background: var(--color-surface-hover);
}

.logs td {
  vertical-align: top;
  font-size: 0.875rem;
}

.chevron {
  display: inline-block;
  width: 0.75rem;
  color: var(--color-text-muted);
}

.nowrap {
  white-space: nowrap;
}

.muted {
  color: var(--color-text-muted);
}

.numeric {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.logs code {
  font-family: var(--font-mono);
  font-size: 0.8125rem;
}

.message {
  word-break: break-word;
}

.badge {
  display: inline-block;
  padding: 0.0625rem 0.4375rem;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--level-accent) 16%, transparent);
  color: var(--level-accent);
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.status {
  margin-left: 0.375rem;
  padding: 0.0625rem 0.375rem;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 700;
}

.status--2xx {
  background: color-mix(in srgb, var(--color-success) 15%, transparent);
  color: var(--color-success);
}

.status--3xx {
  background: color-mix(in srgb, var(--color-info) 15%, transparent);
  color: var(--color-info);
}

.status--4xx {
  background: color-mix(in srgb, var(--color-warning) 15%, transparent);
  color: var(--color-warning);
}

.status--5xx {
  background: color-mix(in srgb, var(--color-danger) 15%, transparent);
  color: var(--color-danger);
}

.logs__detail td {
  padding-top: 0;
  background: var(--color-surface-sunken);
}

.context {
  display: grid;
  grid-template-columns: 7rem 1fr;
  gap: 0.25rem 0.75rem;
  margin: 0 0 0.75rem;
  font-size: 0.8125rem;
}

.context dt {
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: 0.75rem;
}

.context dd {
  margin: 0;
  word-break: break-all;
}

.meta {
  max-height: 20rem;
  margin: 0;
  padding: 0.625rem 0.75rem;
  overflow: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text-muted);
  font-size: 0.75rem;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.state {
  padding: 2.5rem;
  text-align: center;
  color: var(--color-text-muted);
}

.footer {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding-top: 1rem;
}

.footer__range {
  margin-right: auto;
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}

.footer__page {
  font-size: 0.875rem;
}

.alert {
  padding: 0.625rem 0.875rem;
  margin-bottom: 1rem;
  border-radius: var(--radius-md);
  font-size: 0.875rem;
}

.alert--danger {
  background: color-mix(in srgb, var(--color-danger) 12%, transparent);
  color: var(--color-danger);
}
</style>
