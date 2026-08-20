/**
 * Router.
 *
 * Routes are declared statically (a lazy-loaded component per screen) but
 * *access* to them is not: each route names the permission it needs, and the
 * guard checks it against the permission map the server sent. Adding a screen
 * therefore means adding a route with a `permission` meta and a matching
 * declaration in the backend module manifest - nothing else.
 */

import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth.store';
import { usePlatformStore } from '@/stores/platform.store';

const routes = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/modules/access-control/views/LoginView.vue'),
    meta: { public: true, layout: 'blank' }
  },

  {
    path: '/',
    component: () => import('@/layouts/AppLayout.vue'),
    children: [
      {
        path: '',
        name: 'dashboard',
        component: () => import('@/modules/dashboard/DashboardView.vue'),
        meta: { titleKey: 'menu.dashboard' }
      },

      // --- Access control ---------------------------------------------------
      {
        path: 'security/users',
        name: 'security-users',
        component: () => import('@/modules/access-control/views/UserListView.vue'),
        meta: { permission: { resource: '/security/users', action: 'view' }, titleKey: 'menu.security.users' }
      },
      {
        path: 'security/users/:id',
        name: 'security-user-detail',
        component: () => import('@/modules/access-control/views/UserDetailView.vue'),
        meta: { permission: { resource: '/security/users', action: 'view' }, titleKey: 'menu.security.users' }
      },
      {
        path: 'security/roles',
        name: 'security-roles',
        component: () => import('@/modules/access-control/views/RoleListView.vue'),
        meta: { permission: { resource: '/security/roles', action: 'view' }, titleKey: 'menu.security.roles' }
      },
      {
        path: 'security/roles/:id',
        name: 'security-role-detail',
        component: () => import('@/modules/access-control/views/RoleDetailView.vue'),
        meta: { permission: { resource: '/security/roles', action: 'view' }, titleKey: 'menu.security.roles' }
      },
      {
        // The optional segment is the role *code* (`ADMIN`), not its id: it is
        // unique, URL-safe by its own validation rule, and readable in a link
        // someone pastes into a ticket - which `?group=6a7086caa452b772…` was
        // not.
        path: 'security/permissions/:group?',
        name: 'security-permissions',
        component: () => import('@/modules/access-control/views/PermissionMatrixView.vue'),
        meta: {
          permission: { resource: '/security/permissions', action: 'view' },
          titleKey: 'menu.security.permissions'
        }
      },
      {
        path: 'security/policies',
        name: 'security-policies',
        component: () => import('@/modules/access-control/views/PolicyListView.vue'),
        meta: { permission: { resource: '/security/policies', action: 'view' }, titleKey: 'menu.security.policies' }
      },
      {
        path: 'security/sessions',
        name: 'security-sessions',
        component: () => import('@/modules/access-control/views/SessionListView.vue'),
        meta: { permission: { resource: '/security/sessions', action: 'view' }, titleKey: 'menu.security.sessions' }
      },
      {
        path: 'security/audit',
        name: 'security-audit',
        component: () => import('@/modules/access-control/views/AuditLogView.vue'),
        meta: { permission: { resource: '/security/audit', action: 'view' }, titleKey: 'menu.security.audit' }
      },

      // --- Observability ----------------------------------------------------
      {
        path: 'observability/logs',
        name: 'observability-logs',
        component: () => import('@/modules/observability/views/LogListView.vue'),
        meta: {
          permission: { resource: '/observability/logs', action: 'view' },
          titleKey: 'menu.observability.logs'
        }
      },

      // --- Settings ---------------------------------------------------------
      // One component serves every settings group: it renders whatever the
      // schema endpoint returns for `:group`. Adding a settings group on the
      // backend needs no route and no component here.
      {
        path: 'settings/:group',
        name: 'settings',
        component: () => import('@/modules/settings/views/SettingsView.vue'),
        meta: { titleKey: 'menu.settings' }
      },

      // --- Account ----------------------------------------------------------
      {
        path: 'account/profile',
        name: 'account-profile',
        component: () => import('@/modules/access-control/views/ProfileView.vue'),
        meta: { titleKey: 'menu.account.profile' }
      }
    ]
  },

  {
    path: '/forbidden',
    name: 'forbidden',
    component: () => import('@/components/common/ForbiddenView.vue'),
    meta: { public: true, layout: 'blank' }
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/components/common/NotFoundView.vue'),
    meta: { public: true, layout: 'blank' }
  }
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior: (to, from, saved) => saved || { top: 0 }
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  const platform = usePlatformStore();

  // One silent refresh attempt per page load restores a session across a
  // reload without ever showing the login screen unnecessarily.
  if (!auth.initialised) {
    await auth.restore();
  }

  if (to.meta.public) {
    // A signed-in user has no reason to see the login screen.
    if (to.name === 'login' && auth.isAuthenticated) return { name: 'dashboard' };
    return true;
  }

  if (!auth.isAuthenticated) {
    return { name: 'login', query: to.fullPath === '/' ? {} : { returnTo: to.fullPath } };
  }

  // A user who must change their password can go nowhere else.
  if (platform.user?.mustChangePassword && to.name !== 'account-profile') {
    return { name: 'account-profile', query: { forcePasswordChange: '1' } };
  }

  if (to.meta.permission) {
    const { resource, action } = to.meta.permission;
    if (!platform.can(resource, action)) return { name: 'forbidden' };
  }

  return true;
});

// The API client raises this when a refresh fails; the router owns the
// redirect so it happens in one place regardless of which call triggered it.
window.addEventListener('auth:session-expired', () => {
  useAuthStore().clear();
  if (router.currentRoute.value.name !== 'login') {
    router.push({ name: 'login', query: { expired: '1' } });
  }
});

export default router;
