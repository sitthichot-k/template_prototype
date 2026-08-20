<script setup>
/**
 * Admin dashboard - the overall state of the system on one screen.
 *
 * Every panel is permission-aware and best-effort: a section the caller may
 * not read is left out rather than rendered as an error, so an operator, a
 * security officer and a read-only auditor each get a page that makes sense
 * without three separate dashboards existing.
 *
 * The traffic, latency and endpoint figures are derived from the application
 * log rather than from a metrics store. That means the number in a tile and
 * the row behind it in the log viewer can never disagree - and it costs no
 * extra infrastructure, which matters for a template a child project has to
 * deploy.
 *
 * A child project is expected to add its own domain panels below; what is
 * worth keeping is the shape - counts, then health, then recent activity.
 */

import { computed, onMounted, ref } from 'vue';
import { usePlatformStore } from '@/stores/platform.store';
import api from '@/services/api';

const platform = usePlatformStore();

const loading = ref(true);
const counts = ref({ users: null, roles: null, sessions: null, audit: null });
const recent = ref([]);
const auditSummary = ref(null);
const perf = ref(null);

onMounted(load);

async function load() {
  loading.value = true;

  const [users, roles, sessions, audit, summary, performance] = await Promise.all([
    total('/users', '/security/users'),
    total('/roles', '/security/roles'),
    total('/sessions', '/security/sessions'),
    recentAudit(),
    safe(can('/security/audit') ? api.get('/audit/summary') : null),
    safe(can('/observability/logs') ? api.get('/logs/stats') : null)
  ]);

  counts.value = { users, roles, sessions, audit: audit?.total ?? null };
  recent.value = audit?.items || [];
  auditSummary.value = summary;
  perf.value = performance;
  loading.value = false;
}

function can(resource) {
  return platform.can(resource, 'view');
}

// Panels are independent: one refusal must not blank the others out.
async function safe(promise, fallback = null) {
  if (!promise) return fallback;
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

/** `limit=1` because only `meta.pagination.total` is wanted, not the rows. */
async function total(endpoint, resource) {
  if (!can(resource)) return null;
  const result = await safe(api.list(endpoint, { limit: 1 }));
  return result?.meta?.pagination?.total ?? null;
}

async function recentAudit() {
  if (!can('/security/audit')) return null;
  const result = await safe(api.list('/audit', { limit: 8, sort: '-occurredAt' }));
  if (!result) return null;
  return { items: result.items, total: result.meta?.pagination?.total ?? null };
}

const greeting = computed(() => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
});

/* --- Tiles ------------------------------------------------------------------ */

const kpis = computed(() =>
  [
    { key: 'users', label: 'Users', value: counts.value.users, accent: '#3b82f6', to: '/security/users' },
    { key: 'roles', label: 'Roles', value: counts.value.roles, accent: '#8b5cf6', to: '/security/roles' },
    {
      key: 'sessions',
      label: 'Active sessions',
      value: counts.value.sessions,
      accent: '#10b981',
      to: '/security/sessions'
    },
    { key: 'audit', label: 'Audit entries', value: counts.value.audit, accent: '#f59e0b', to: '/security/audit' }
  ].filter((kpi) => kpi.value !== null)
);

/* --- Traffic ---------------------------------------------------------------- */

const throughput = computed(() => perf.value?.throughput || []);
const throughputPeak = computed(() => Math.max(1, ...throughput.value.map((point) => point.count)));

const STATUS_COLORS = {
  '2xx': 'var(--color-success)',
  '3xx': 'var(--color-info)',
  '4xx': 'var(--color-warning)',
  '5xx': 'var(--color-danger)'
};

const statusTotal = computed(() =>
  (perf.value?.statusBreakdown || []).reduce((sum, entry) => sum + entry.count, 0)
);

/** `null` means the server could not measure it, which is not the same as 0. */
const latencyTiles = computed(() => {
  const latency = perf.value?.latency;
  if (!latency) return [];

  return [
    { key: 'avg', value: latency.avg },
    { key: 'p50', value: latency.p50 },
    { key: 'p95', value: latency.p95 },
    { key: 'p99', value: latency.p99 },
    { key: 'max', value: latency.max }
  ].filter((tile) => tile.value !== null && tile.value !== undefined);
});

const topEndpoints = computed(() => perf.value?.topEndpoints || []);
const endpointPeak = computed(() => Math.max(1, ...topEndpoints.value.map((entry) => entry.count)));

/* --- Security activity ------------------------------------------------------ */

const activityByCategory = computed(() => {
  const rows = new Map();

  for (const entry of auditSummary.value?.breakdown || []) {
    const row = rows.get(entry.category) || { category: entry.category, success: 0, failure: 0, denied: 0, total: 0 };
    if (entry.outcome in row) row[entry.outcome] += entry.count;
    row.total += entry.count;
    rows.set(entry.category, row);
  }

  return Array.from(rows.values()).sort((a, b) => b.total - a.total);
});

const activityPeak = computed(() => Math.max(1, ...activityByCategory.value.map((row) => row.total)));

const problemCount = computed(() =>
  activityByCategory.value.reduce((count, row) => count + row.failure + row.denied, 0)
);

/* --- Formatting ------------------------------------------------------------- */

function relativeTime(value) {
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function formatUptime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

const grantedCount = computed(() => Object.values(platform.permissions || {}).reduce((n, a) => n + a.length, 0));
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-header__title">{{ greeting }}, {{ platform.user?.displayName }}</h1>
        <p class="page-header__meta">
          {{ platform.appName }}
          <span v-if="platform.server.version"> · v{{ platform.server.version }}</span>
          <span v-if="platform.server.environment"> · {{ platform.server.environment }}</span>
        </p>
      </div>

      <button type="button" class="btn btn--ghost" :disabled="loading" @click="load">
        {{ loading ? 'Refreshing…' : 'Refresh' }}
      </button>
    </header>

    <p v-if="loading" class="state">Loading…</p>

    <template v-else>
      <section v-if="kpis.length" class="kpis">
        <RouterLink v-for="kpi in kpis" :key="kpi.key" :to="kpi.to" class="card kpi">
          <span class="kpi__bar" :style="{ background: kpi.accent }" aria-hidden="true" />
          <span class="kpi__label">{{ kpi.label }}</span>
          <span class="kpi__value">{{ kpi.value.toLocaleString() }}</span>
        </RouterLink>
      </section>

      <!-- Traffic health: only rendered for someone who may read the log. -->
      <template v-if="perf">
        <section class="kpis">
          <div class="card kpi">
            <span class="kpi__bar" style="background: #6366f1" aria-hidden="true" />
            <span class="kpi__label">Requests · {{ perf.windowHours }}h</span>
            <span class="kpi__value">{{ perf.requests.toLocaleString() }}</span>
          </div>

          <div class="card kpi">
            <span class="kpi__bar" :style="{ background: perf.errorRate >= 5 ? '#ef4444' : '#10b981' }" aria-hidden="true" />
            <span class="kpi__label">Error rate</span>
            <span class="kpi__value" :class="{ 'kpi__value--alert': perf.errorRate >= 5 }">{{ perf.errorRate }}%</span>
          </div>

          <div class="card kpi">
            <span class="kpi__bar" style="background: #f59e0b" aria-hidden="true" />
            <span class="kpi__label">Latency {{ perf.latency.p95 != null ? 'p95' : 'avg' }}</span>
            <span class="kpi__value">{{ perf.latency.p95 ?? perf.latency.avg }}ms</span>
          </div>

          <div class="card kpi">
            <span class="kpi__bar" style="background: #06b6d4" aria-hidden="true" />
            <span class="kpi__label">Uptime</span>
            <span class="kpi__value">{{ formatUptime(perf.process.uptimeSec) }}</span>
          </div>
        </section>

        <div class="panels">
          <section class="card panel">
            <header class="panel__header">
              <h2 class="panel__title">Requests per hour</h2>
              <span class="panel__hint">peak {{ throughputPeak }}</span>
            </header>

            <div class="spark" role="img" :aria-label="`Requests per hour over the last ${perf.windowHours} hours`">
              <span
                v-for="(point, index) in throughput"
                :key="index"
                class="spark__bar"
                :style="{ height: `${Math.max(2, (point.count / throughputPeak) * 100)}%` }"
                :title="`${point.hour} · ${point.count}`"
              />
            </div>

            <div class="axis">
              <span>{{ throughput[0]?.hour }}</span>
              <span>{{ throughput[throughput.length - 1]?.hour }}</span>
            </div>

            <p class="panel__subtitle">Latency (ms)</p>
            <div class="latency">
              <div v-for="tile in latencyTiles" :key="tile.key" class="latency__item">
                <span class="latency__value">{{ tile.value }}</span>
                <span class="latency__key">{{ tile.key }}</span>
              </div>
            </div>

            <template v-if="statusTotal">
              <p class="panel__subtitle">Status mix</p>
              <div class="stack">
                <span
                  v-for="entry in perf.statusBreakdown"
                  :key="entry.klass"
                  class="stack__segment"
                  :style="{ flex: entry.count, background: STATUS_COLORS[entry.klass] }"
                  :title="`${entry.klass}: ${entry.count}`"
                />
              </div>
              <div class="legend">
                <span v-for="entry in perf.statusBreakdown" :key="entry.klass">
                  <i :style="{ background: STATUS_COLORS[entry.klass] }" aria-hidden="true" />{{ entry.klass }}
                  {{ entry.count }}
                </span>
              </div>
            </template>
          </section>

          <section class="card panel">
            <header class="panel__header">
              <h2 class="panel__title">Busiest endpoints</h2>
              <RouterLink to="/observability/logs" class="panel__link">Logs →</RouterLink>
            </header>

            <p v-if="!topEndpoints.length" class="muted">No traffic recorded yet.</p>

            <div v-for="endpoint in topEndpoints" :key="`${endpoint.method}${endpoint.path}`" class="bar">
              <span class="bar__name" :title="`${endpoint.method} ${endpoint.path}`">
                <code>{{ endpoint.method }}</code> {{ endpoint.path }}
              </span>
              <span class="bar__track">
                <span class="bar__fill" :style="{ width: `${(endpoint.count / endpointPeak) * 100}%` }" />
              </span>
              <span class="bar__count">{{ endpoint.count }}</span>
            </div>

            <template v-if="perf.slowest?.length">
              <p class="panel__subtitle">Slowest (average)</p>
              <div v-for="endpoint in perf.slowest" :key="`slow-${endpoint.method}${endpoint.path}`" class="slow">
                <span class="bar__name" :title="`${endpoint.method} ${endpoint.path}`">
                  <code>{{ endpoint.method }}</code> {{ endpoint.path }}
                </span>
                <span class="slow__ms">{{ endpoint.avgMs }}ms</span>
              </div>
            </template>
          </section>
        </div>
      </template>

      <div class="panels">
        <section v-if="activityByCategory.length" class="card panel">
          <header class="panel__header">
            <h2 class="panel__title">Security activity</h2>
            <RouterLink to="/security/audit" class="panel__link">Audit trail →</RouterLink>
          </header>

          <div v-for="row in activityByCategory" :key="row.category" class="bar">
            <span class="bar__name">{{ row.category }}</span>
            <span class="bar__track">
              <span
                v-if="row.success"
                class="bar__fill bar__fill--success"
                :style="{ width: `${(row.success / activityPeak) * 100}%` }"
                :title="`${row.success} succeeded`"
              />
              <span
                v-if="row.failure + row.denied"
                class="bar__fill bar__fill--problem"
                :style="{ width: `${((row.failure + row.denied) / activityPeak) * 100}%` }"
                :title="`${row.failure} failed, ${row.denied} denied`"
              />
            </span>
            <span class="bar__count">{{ row.total }}</span>
          </div>

          <p class="panel__footnote" :class="{ 'panel__footnote--alert': problemCount }">
            <template v-if="problemCount">
              {{ problemCount }} failed or denied attempt{{ problemCount === 1 ? '' : 's' }} in this window.
            </template>
            <template v-else>No failed or denied attempts in this window.</template>
          </p>
        </section>

        <section v-if="recent.length" class="card panel">
          <header class="panel__header">
            <h2 class="panel__title">Recent activity</h2>
            <RouterLink to="/security/audit" class="panel__link">View all →</RouterLink>
          </header>

          <ul class="feed">
            <li v-for="entry in recent" :key="entry.id" class="feed__item">
              <span class="dot" :class="`dot--${entry.outcome}`" aria-hidden="true" />
              <div class="feed__body">
                <p class="feed__action">{{ entry.action }}</p>
                <p class="feed__meta">
                  {{ entry.actorLabel || 'system' }}
                  <span v-if="entry.target?.type"> · {{ entry.target.label || entry.target.id }}</span>
                </p>
              </div>
              <time class="feed__time" :datetime="entry.occurredAt">{{ relativeTime(entry.occurredAt) }}</time>
            </li>
          </ul>
        </section>

        <section class="card panel">
          <header class="panel__header">
            <h2 class="panel__title">Your access</h2>
            <RouterLink to="/account/profile" class="panel__link">Profile →</RouterLink>
          </header>

          <p v-if="platform.superAdmin" class="badge badge--danger">Super administrator</p>

          <dl class="facts">
            <dt>Roles</dt>
            <dd>
              <span v-if="!platform.roles.length" class="muted">None</span>
              <span v-for="code in platform.roles" :key="code" class="chip">{{ code }}</span>
            </dd>

            <dt>Granted rules</dt>
            <dd>{{ platform.superAdmin ? 'Everything' : grantedCount }}</dd>

            <dt>Scope</dt>
            <dd>{{ Object.keys(platform.scopes || {}).join(', ') || 'global' }}</dd>
          </dl>
        </section>

        <section class="card panel">
          <header class="panel__header">
            <h2 class="panel__title">System</h2>
          </header>

          <dl class="facts">
            <dt>Environment</dt>
            <dd>{{ platform.server.environment || '—' }}</dd>
            <dt>Version</dt>
            <dd>{{ platform.server.version || '—' }}</dd>
            <dt>API</dt>
            <dd><code>{{ platform.server.apiPrefix || '—' }}</code></dd>

            <template v-if="perf">
              <dt>Node</dt>
              <dd>{{ perf.process.nodeVersion }}</dd>
              <dt>Memory</dt>
              <dd>{{ perf.process.heapUsedMb }} MB heap · {{ perf.process.rssMb }} MB rss</dd>
              <dt>Database</dt>
              <dd>{{ perf.process.mongo }}</dd>
            </template>
          </dl>

          <p class="panel__subtitle">Loaded modules</p>
          <ul class="modules">
            <li v-for="id in platform.modules" :key="id">{{ id }}</li>
          </ul>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>

.state {
  padding: 2rem 0;
  color: var(--color-text-muted);
}

/* --- KPI tiles -------------------------------------------------------------- */

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
  color: inherit;
  text-decoration: none;
  transition: border-color 0.12s ease;
}

a.kpi:hover {
  border-color: var(--color-border-strong);
}

/* A thin coloured edge instead of a tinted card: it survives both a white and
   a black surface without turning into a wash. */
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

.kpi__value--alert {
  color: var(--color-danger);
}

/* --- Panels ----------------------------------------------------------------- */

.panels {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(21rem, 1fr));
  gap: 1rem;
  align-items: start;
  margin-bottom: 1.25rem;
}

.panel {
  padding: var(--space-4) var(--space-6) var(--space-6);
}

.panel__header {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.panel__title {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
}

.panel__hint {
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.panel__link {
  margin-left: auto;
  font-size: 0.8125rem;
  text-decoration: none;
}

.panel__subtitle {
  margin: 1.25rem 0 0.5rem;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.panel__footnote {
  margin: 1rem 0 0;
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}

.panel__footnote--alert {
  color: var(--color-warning);
  font-weight: 600;
}

/* --- Sparkline -------------------------------------------------------------- */

.spark {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 6rem;
}

.spark__bar {
  flex: 1;
  min-height: 2px;
  border-radius: 2px 2px 0 0;
  background: var(--color-primary);
  opacity: 0.75;
}

.spark__bar:hover {
  opacity: 1;
}

.axis {
  display: flex;
  justify-content: space-between;
  margin-top: 0.375rem;
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.latency {
  display: flex;
  gap: 0.5rem;
}

.latency__item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.125rem;
  padding: 0.5rem 0.25rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.latency__value {
  font-size: 1rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.latency__key {
  font-size: 0.625rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.stack {
  display: flex;
  height: 0.625rem;
  border-radius: var(--radius-full);
  background: var(--color-surface-hover);
  overflow: hidden;
}

.stack__segment {
  min-width: 2px;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 0.5rem;
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.legend span {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.legend i {
  width: 0.625rem;
  height: 0.625rem;
  border-radius: 2px;
}

/* --- Bars ------------------------------------------------------------------- */

.bar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.625rem;
}

.bar__name {
  flex: 0 0 9rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.8125rem;
  font-weight: 600;
  text-transform: capitalize;
}

.bar__name code {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  color: var(--color-text-muted);
  text-transform: none;
}

.bar__track {
  display: flex;
  flex: 1;
  height: 0.625rem;
  border-radius: var(--radius-full);
  background: var(--color-surface-hover);
  overflow: hidden;
}

.bar__fill {
  height: 100%;
  background: var(--color-primary);
}

.bar__fill--success {
  background: var(--color-success);
}

.bar__fill--problem {
  background: var(--color-danger);
}

.bar__count {
  flex: 0 0 2.5rem;
  text-align: right;
  font-size: 0.8125rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.slow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.375rem;
}

.slow__ms {
  flex: none;
  font-size: 0.8125rem;
  font-weight: 700;
  color: var(--color-warning);
  font-variant-numeric: tabular-nums;
}

/* --- Activity feed ---------------------------------------------------------- */

.feed {
  list-style: none;
  margin: 0;
  padding: 0;
}

.feed__item {
  display: flex;
  align-items: flex-start;
  gap: 0.625rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--color-border);
}

.feed__item:last-child {
  border-bottom: 0;
}

.dot {
  flex: none;
  width: 0.5rem;
  height: 0.5rem;
  margin-top: 0.4375rem;
  border-radius: var(--radius-full);
  background: var(--color-text-muted);
}

.dot--success {
  background: var(--color-success);
}

.dot--failure,
.dot--denied {
  background: var(--color-danger);
}

.feed__body {
  flex: 1;
  min-width: 0;
}

.feed__action {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.feed__meta {
  margin: 0.125rem 0 0;
  font-size: 0.75rem;
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.feed__time {
  flex: none;
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

/* --- Facts and chips -------------------------------------------------------- */

.facts {
  display: grid;
  grid-template-columns: 8rem 1fr;
  gap: 0.5rem 0.75rem;
  margin: 0;
  font-size: 0.875rem;
}

.facts dt {
  color: var(--color-text-muted);
}

.facts dd {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.facts code {
  font-family: var(--font-mono);
  font-size: 0.8125rem;
}

.chip {
  padding: 0.0625rem 0.4375rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  font-family: var(--font-mono);
  font-size: 0.75rem;
}

.muted {
  color: var(--color-text-muted);
}

.badge {
  display: inline-block;
  margin: 0 0 0.875rem;
  padding: 0.125rem 0.5rem;
  border-radius: var(--radius-sm);
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.badge--danger {
  background: color-mix(in srgb, var(--color-danger) 15%, transparent);
  color: var(--color-danger);
}

.modules {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  list-style: none;
  margin: 0;
  padding: 0;
}

.modules li {
  padding: 0.125rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  font-family: var(--font-mono);
  font-size: 0.75rem;
}
</style>
