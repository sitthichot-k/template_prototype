import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';

/**
 * Vite configuration.
 *
 * Mode maps to the deployment tier (local / preproduction / production) so a
 * build always reads the matching `.env.<mode>` file - the same three-tier
 * split the backend and compose files use.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const isProduction = mode === 'production';

  /**
   * Extra hostnames the dev server will answer to, comma separated.
   * Read from the process environment first, like VITE_DEV_API_TARGET below,
   * because compose passes it in as a real variable rather than a .env entry.
   */
  const extraAllowedHosts = (
    process.env.VITE_DEV_ALLOWED_HOSTS ||
    env.VITE_DEV_ALLOWED_HOSTS ||
    ''
  )
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);

  return {
    plugins: [vue()],

    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    },

    /**
     * Vitest.
     *
     * `jsdom` rather than the default node environment because the shared form
     * primitives are only meaningful against real elements - `FormField` finds
     * the control it wraps by querying its own DOM subtree, which is what lets
     * it work with an input, a select or a textarea without being told which.
     */
    test: {
      environment: 'jsdom',
      include: ['src/**/*.{test,spec}.js'],
      restoreMocks: true
    },

    server: {
      host: '0.0.0.0',
      port: 8080,
      strictPort: true,

      // Vite rejects a request whose Host header it does not recognise. That
      // check is what stops DNS rebinding from reaching a dev server bound to
      // 0.0.0.0 inside the container, and it also rejects a tunnel hostname -
      // so putting a local stack in front of someone for review needs the
      // tunnel's domain declared here.
      //
      // `.trycloudflare.com` is allowed by default because a quick tunnel
      // mints a new random hostname every run; pinning one would mean editing
      // this file before every share. The entry exposes nothing on its own:
      // the dev server is published on 127.0.0.1 only, so it is reachable
      // from outside solely while `cloudflared` is deliberately running.
      //
      // Add a named tunnel, an ngrok domain or a LAN hostname through
      // VITE_DEV_ALLOWED_HOSTS rather than editing this list.
      //
      // Development only - preproduction and production serve the built SPA
      // from nginx and never start this server.
      allowedHosts: ['localhost', '127.0.0.1', '.trycloudflare.com', ...extraAllowedHosts],

      // A bind-mounted source tree on Windows or macOS does not deliver inode
      // events to the Linux container, so the watcher never fires and HMR
      // appears broken. Compose sets VITE_USE_POLLING for the containerised
      // dev server; running Vite on the host needs no polling and does not
      // pay for it.
      watch: {
        usePolling: process.env.VITE_USE_POLLING === 'true',
        interval: 1000
      },

      // Proxying in development keeps the browser on one origin, so the code
      // path exercised locally matches the same-origin setup in the other
      // tiers rather than relying on CORS.
      //
      // The target is resolved from the environment because the correct value
      // differs by where the dev server runs: `http://backend:8080` inside
      // compose, `http://127.0.0.1:8081` when Vite runs on the host. Inside a
      // container 127.0.0.1 is the dev server itself, which silently times
      // out every API call.
      proxy: {
        '/api': {
          target: process.env.VITE_DEV_API_TARGET || env.VITE_DEV_API_TARGET || 'http://127.0.0.1:8081',
          changeOrigin: true
        }
      }
    },

    build: {
      target: 'es2022',
      outDir: 'dist',
      // Source maps in preproduction make a staging bug diagnosable; in
      // production they would hand out the unminified source.
      sourcemap: !isProduction,
      chunkSizeWarningLimit: 800,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['vue', 'vue-router', 'pinia'],
            i18n: ['vue-i18n']
          }
        }
      }
    },

    define: {
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version || '0.0.0')
    }
  };
});
