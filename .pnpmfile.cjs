// pnpm build-script allowlist for the Denti-Code U3 workspace.
//
// esbuild (a Vite / Vitest / tsx transitive dependency) legitimately needs its
// postinstall to place the platform binary. Nothing else is allowed to run
// lifecycle scripts.
module.exports = {
  hooks: {
    readPackage: (pkg) => {
      if (pkg.scripts?.postinstall && pkg.name !== 'esbuild') {
        delete pkg.scripts.postinstall;
      }
      return pkg;
    },
  },
};
