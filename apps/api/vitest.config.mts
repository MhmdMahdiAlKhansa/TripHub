import { defineConfig } from 'vitest/config';

// Tests are transformed by Vitest's built-in compiler. Every Nest dependency is injected with an explicit
// @Inject(token), so no decorator metadata is needed. (The swc native binary used before can be blocked by
// Windows Smart App Control.)
export default defineConfig({
  test: { globals: false, environment: 'node', testTimeout: 60_000, hookTimeout: 60_000 },
});
