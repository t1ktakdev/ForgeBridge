import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { ForgeBridgeError } from '../core/errors.js';

export type ResolvedPath = {
  requested: string;
  absolute: string;
  canonical: string;
  root: string;
  exists: boolean;
  isSymbolicLink: boolean;
};

function comparisonValue(value: string): string {
  const normalized = path.normalize(value);
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
}

function contains(root: string, candidate: string): boolean {
  const relative = path.relative(comparisonValue(root), comparisonValue(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function rejectMalformedPath(value: string): void {
  if (value.includes('\0')) throw new ForgeBridgeError('invalid_path', 'Path contains a NUL byte');
  if (process.platform !== 'win32') return;
  const normalized = value.replaceAll('/', '\\');
  if (/^\\\\[.?]\\/u.test(normalized)) {
    throw new ForgeBridgeError('invalid_path', 'Windows device namespace paths are not allowed');
  }
  const root = path.win32.parse(normalized).root;
  if (normalized.slice(root.length).includes(':')) {
    throw new ForgeBridgeError('invalid_path', 'NTFS alternate data streams are not allowed');
  }
}

async function exists(value: string): Promise<boolean> {
  try {
    await lstat(value);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

// Resolve existing ancestors as well as targets, so future paths retain the same physical scope.
export async function canonicalPath(value: string): Promise<string> {
  rejectMalformedPath(value);
  const missing: string[] = [];
  let ancestor = path.resolve(value);
  while (!(await exists(ancestor))) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) {
      throw new ForgeBridgeError('path_not_found', 'No existing ancestor for path', {
        requested: value,
      });
    }
    missing.unshift(path.basename(ancestor));
    ancestor = parent;
  }
  return path.join(await realpath(ancestor), ...missing);
}

export class PathGuard {
  readonly roots: readonly string[];
  readonly protectedPaths: readonly string[];
  readonly #defaultRoot: string;

  private constructor(roots: string[], protectedPaths: string[]) {
    this.roots = roots;
    this.protectedPaths = protectedPaths;
    const first = roots[0];
    if (!first)
      throw new ForgeBridgeError('invalid_config', 'At least one allowed root is required');
    this.#defaultRoot = first;
  }

  static async create(
    roots: readonly string[],
    protectedPaths: readonly string[] = [],
  ): Promise<PathGuard> {
    const canonicalRoots: string[] = [];
    for (const root of roots) {
      rejectMalformedPath(root);
      canonicalRoots.push(await realpath(path.resolve(root)));
    }
    const canonicalProtectedPaths: string[] = [];
    for (const protectedPath of protectedPaths) {
      rejectMalformedPath(protectedPath);
      canonicalProtectedPaths.push(await canonicalPath(protectedPath));
    }
    return new PathGuard(
      [...new Set(canonicalRoots.map(path.normalize))],
      [...new Set(canonicalProtectedPaths.map(path.normalize))],
    );
  }

  async resolve(
    requested: string,
    options: { followFinalSymlink?: boolean } = {},
  ): Promise<ResolvedPath> {
    rejectMalformedPath(requested);
    const absolute = path.resolve(
      path.isAbsolute(requested) ? requested : path.join(this.#defaultRoot, requested),
    );
    const targetExists = await exists(absolute);
    let canonical: string;
    let isSymbolicLink = false;

    if (targetExists) {
      const stat = await lstat(absolute);
      isSymbolicLink = stat.isSymbolicLink();
      if (isSymbolicLink && options.followFinalSymlink === false) {
        canonical = path.join(await realpath(path.dirname(absolute)), path.basename(absolute));
      } else {
        canonical = await realpath(absolute);
      }
    } else {
      canonical = await canonicalPath(absolute);
    }

    const root = this.roots
      .filter((allowedRoot) => contains(allowedRoot, canonical))
      .sort((left, right) => right.length - left.length)[0];
    if (!root) {
      throw new ForgeBridgeError('path_outside_roots', 'Path resolves outside allowed roots', {
        requested,
      });
    }

    return {
      requested,
      absolute,
      canonical: path.normalize(canonical),
      root,
      exists: targetExists,
      isSymbolicLink,
    };
  }

  isSensitive(resolved: ResolvedPath): boolean {
    if (this.isProtected(resolved)) return true;
    const relative = path.relative(resolved.root, resolved.canonical).replaceAll('\\', '/');
    const basename = path.basename(resolved.canonical).toLocaleLowerCase('en-US');
    const normalized = `/${relative.toLocaleLowerCase('en-US')}`;
    return (
      /^\.env(?:\.|$)/u.test(basename) ||
      /\.(?:pem|p12|pfx|key)$/u.test(basename) ||
      /^(?:\.git-credentials|\.netrc|\.npmrc|\.pypirc|credentials(?:\.json)?)$/u.test(basename) ||
      /\/(?:\.ssh|\.aws|\.azure|\.gnupg|\.kube|\.docker)(?:\/|$)/u.test(normalized) ||
      /\/.config\/(?:gcloud|gh|op)(?:\/|$)/u.test(normalized) ||
      /\/appdata\/(?:local|roaming)\/(?:google\/chrome|microsoft\/edge)\/user data(?:\/|$)/u.test(
        normalized,
      ) ||
      normalized.endsWith('/.git/config') ||
      normalized.endsWith('/forgebridge/identity.json') ||
      normalized.endsWith('/forgebridge/local-token.json') ||
      normalized.endsWith('/.forgebridge/identity.json') ||
      normalized.endsWith('/.forgebridge/local-token.json')
    );
  }

  isProtected(resolved: ResolvedPath | string): boolean {
    const candidate = typeof resolved === 'string' ? path.normalize(resolved) : resolved.canonical;
    return this.protectedPaths.some((protectedPath) => contains(protectedPath, candidate));
  }

  isSensitivePath(candidate: string): boolean {
    const canonical = path.normalize(candidate);
    const root = this.roots
      .filter((allowedRoot) => contains(allowedRoot, canonical))
      .sort((left, right) => right.length - left.length)[0];
    if (!root) return true;
    return this.isSensitive({
      requested: candidate,
      absolute: canonical,
      canonical,
      root,
      exists: true,
      isSymbolicLink: false,
    });
  }
}
