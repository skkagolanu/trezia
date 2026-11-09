// Jest stub for packages that intentionally throw outside a bundler (e.g.
// `server-only`, which guards server-only modules but errors on a plain Node
// import). Mapped in jest.config.js so those modules stay unit-testable while
// keeping the real guard in production builds.
module.exports = {};
