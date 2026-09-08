import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
        // Tests must never read production data: shadow the remote KV
        // binding with a local, empty namespace.
        miniflare: {
          kvNamespaces: ['CLUSTER_KV'],
        },
      },
    },
  },
});
