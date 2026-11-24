import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Suites import the app and build a fresh database in beforeAll; parallel cold starts can exceed 10s.
    hookTimeout: 30000,
  },
});
