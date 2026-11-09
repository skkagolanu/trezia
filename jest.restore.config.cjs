const base = require('./jest.config.js');

// Disaster-recovery drill only. Driven by scripts/rehearse-restore.mjs, which runs
// the capture phase, wipes the database, restores a snapshot, then runs the verify
// phase. Kept out of jest.rls.config.cjs because neither phase is meaningful on its
// own, and verify cannot pass until the wipe-and-restore between them has happened.
module.exports = {
  ...base,
  testMatch: ['**/__tests__/integration/snapshot-roundtrip.test.ts'],
  testPathIgnorePatterns: [],
  collectCoverage: false,
};
