const path = require('path');

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment:  'node',
  moduleNameMapper: {
    '^@/(.*)$': path.resolve(__dirname, 'src/$1'),
    // server-only throws on a plain Node import by design; stub it so server-only
    // modules stay unit-testable. The real guard still applies in Next builds.
    '^server-only$': path.resolve(__dirname, '__mocks__/empty-module.js'),
  },
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  testPathIgnorePatterns: ['/__tests__/integration/'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: { jsx: 'react-jsx', esModuleInterop: true },
    }],
  },
  // Use Node-native coverage instrumentation.
  coverageProvider: 'v8',
  // Coverage is scoped to pure, unit-testable modules only.
  // Files excluded from this scope (supabase clients, R2 storage, PDF renderer,
  // Resend email, API route handlers) need live external services. Targeted cases
  // belong in __tests__/integration/; exclusion here does not imply they are covered.
  // To add coverage for a new pure module, add it here.
  collectCoverageFrom: [
    'src/lib/utils/**/*.ts',
    'src/lib/validation/**/*.ts',
    '!src/**/*.d.ts',
  ],
  // Enforced only when coverage is collected (npm test -- --coverage).
  // Lives here, not as a CLI flag: quoted-JSON CLI args break under
  // Windows cmd shell quoting, and one canonical place beats three copies.
  coverageThreshold: {
    global: { branches: 60, functions: 60, lines: 60, statements: 60 },
  },
};
