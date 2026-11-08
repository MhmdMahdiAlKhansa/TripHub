import { defineConfig } from 'vitest/config';

// The job tests run against the shared development database, which can hold many rows from other test runs.
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 60_000 } });
