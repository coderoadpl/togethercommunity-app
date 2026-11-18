const isAuthLibrary = (name) => name === 'better-auth' || name?.startsWith('@better-auth/');

module.exports = {
  hooks: {
    readPackage(pkg) {
      if (isAuthLibrary(pkg.name) && pkg.peerDependenciesMeta?.vitest?.optional === true) {
        // The app does not use better-auth/test; its optional peer pulls the test runner into production.
        delete pkg.peerDependencies?.vitest;
        delete pkg.peerDependenciesMeta.vitest;
      }
      return pkg;
    },
  },
};
