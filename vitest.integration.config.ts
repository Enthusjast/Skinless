import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';
import { YGGDRASIL_PRIVATE_KEY_PEM, YGGDRASIL_PUBLIC_KEY_PEM } from './tests/fixtures/yggdrasil-keys';

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations('./migrations');

  return {
    test: {
      include: ['tests/integration/**/*.integration.ts'],
      setupFiles: ['./tests/integration/setup.ts'],
      poolOptions: {
        workers: {
          wrangler: { configPath: './wrangler.toml' },
          miniflare: {
            bindings: {
              TEST_MIGRATIONS: migrations,
              WEB_SESSION_SECRET: 'integration-web-session-secret',
              YGGDRASIL_PRIVATE_KEY_PEM,
              YGGDRASIL_PUBLIC_KEY_PEM,
            },
          },
        },
      },
    },
  };
});
