module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.name === 'better-auth' && pkg.version === '1.6.25') {
        // The app does not use better-auth/test; its optional peer pulls the test runner into production.
        delete pkg.peerDependencies?.vitest;
        delete pkg.peerDependenciesMeta?.vitest;
      }
      return pkg;
    },
  },
};
