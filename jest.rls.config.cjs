const base = require('./jest.config.js');

module.exports = {
  ...base,
  testMatch: ['**/__tests__/integration/**/*.test.ts'],
  // The restore drill lives in the same directory but is not part of this gate:
  // it runs in two phases either side of a database wipe, so running it here
  // would fail its verify phase with nothing yet restored. `npm run restore:drill`
  // owns it via jest.restore.config.cjs.
  testPathIgnorePatterns: ['<rootDir>/__tests__/integration/snapshot-roundtrip.test.ts'],
  collectCoverage: false,
};
