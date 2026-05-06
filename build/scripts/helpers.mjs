import fs from 'fs';
import { builtinModules, createRequire } from 'module';
import path from 'path';

/** First-party path aliases from tsconfig (same segment must not use Node resolution). */
const PATH_ALIAS_RE =
  /^(src|schemas|main|backend|regional|fixtures|reports|models|utils|dummy)\//;

const builtinSet = new Set([
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
]);

function packageRootOf(specifier) {
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
  }
  const i = specifier.indexOf('/');
  return i === -1 ? specifier : specifier.slice(0, i);
}

/**
 * Resolves npm imports from this project's node_modules via Node's resolver.
 * Without this, esbuild's Yarn PnP integration can pick up a `.pnp.cjs` in a
 * parent directory (e.g. $HOME) and fail to resolve this package's deps.
 *
 * @param {string} root
 * @param {string[]} externals esbuild `external` list — must stay external (do not resolve to a file path).
 * @returns {import('esbuild').Plugin}
 */
export function projectNodeModulesResolver(root, externals) {
  const requireFromProject = createRequire(path.join(root, 'package.json'));
  const externalRoots = new Set(externals);

  return {
    name: 'project-node-modules-resolver',
    setup(build) {
      build.onResolve({ filter: /^[\w@]/ }, (args) => {
        if (path.isAbsolute(args.path)) {
          return;
        }
        if (PATH_ALIAS_RE.test(args.path)) {
          return;
        }
        const top = args.path.split('/')[0];
        const withoutTrailingSlash = args.path.replace(/\/+$/, '');
        if (
          builtinSet.has(args.path) ||
          builtinSet.has(withoutTrailingSlash) ||
          builtinSet.has(top)
        ) {
          return {
            path: withoutTrailingSlash,
            external: true,
          };
        }
        const pkgRoot = packageRootOf(args.path);
        if (externalRoots.has(pkgRoot)) {
          return { path: args.path, external: true };
        }
        const resolvePaths = args.importer
          ? [path.dirname(args.importer), root]
          : [root];
        try {
          const resolved = requireFromProject.resolve(args.path, {
            paths: resolvePaths,
          });
          return { path: resolved };
        } catch {
          return undefined;
        }
      });
    },
  };
}

/**
 * Common ESBuild config used for building main process source
 * code for both dev and production.
 *
 * @param {string} root
 * @returns {import('esbuild').BuildOptions}
 */
export function getMainProcessCommonConfig(root) {
  const external = ['knex', 'electron', 'better-sqlite3', 'electron-store'];
  return {
    entryPoints: [
      path.join(root, 'main.ts'),
      path.join(root, 'main', 'preload.ts'),
    ],
    bundle: true,
    sourcemap: true,
    sourcesContent: false,
    platform: 'node',
    target: 'node20',
    absWorkingDir: root,
    tsconfig: path.join(root, 'tsconfig.json'),
    external,
    plugins: [projectNodeModulesResolver(root, external), excludeVendorFromSourceMap],
    write: true,
  };
}

/**
 * ESBuild plugin used to prevent source maps from being generated for
 * packages inside node_modules, only first-party code source maps
 * are to be included.
 *
 * Note, this is used only for the main process source code.
 *
 * source: https://github.com/evanw/esbuild/issues/1685#issuecomment-944916409
 * @type {import('esbuild').Plugin}
 */
export const excludeVendorFromSourceMap = {
  name: 'excludeVendorFromSourceMap',
  setup(build) {
    build.onLoad({ filter: /node_modules/ }, (args) => {
      if (args.path.endsWith('.json')) {
        return;
      }

      return {
        contents:
          fs.readFileSync(args.path, 'utf8') +
          '\n//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIiJdLCJtYXBwaW5ncyI6IkEifQ==',
        loader: 'default',
      };
    });
  },
};
