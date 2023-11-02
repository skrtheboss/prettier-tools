/**
 * This file has been copied from https://github.com/prettier/prettier/blob/2bbbe1a8d17961101d076ac530309fd2c6b06cbe/src/cli/expand-patterns.js
 * and has been adapted to typescript
 */

import { Stats } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import fastGlob from 'fast-glob';
import { SupportLanguage } from 'prettier';

interface Context {
    readonly filePatterns: ReadonlyArray<string | number>;
    readonly languages: ReadonlyArray<SupportLanguage>;
}

async function statSafe(filePath: string): Promise<Stats | null> {
    try {
        return await fs.stat(filePath);
    } catch (error) {
        /* istanbul ignore next */
        if ((error as { code?: string }).code !== 'ENOENT') {
            throw error;
        }

        return null;
    }
}

interface GLobError {
    readonly error: string;
}

export async function* expandPatterns(context: Context): AsyncGenerator<string | GLobError, void, undefined> {
    const cwd = process.cwd();
    const seen = new Set();

    for await (const pathOrError of expandPatternsInternal(context)) {
        if (typeof pathOrError !== 'string') {
            yield pathOrError;
            continue;
        }

        const relativePath = path.relative(cwd, pathOrError);

        // filter out duplicates
        if (seen.has(relativePath)) {
            continue;
        }

        seen.add(relativePath);
        yield relativePath;
    }
}

async function* expandPatternsInternal(context: Context): AsyncGenerator<string | GLobError, void, undefined> {
    // Ignores files in version control systems directories and `node_modules`
    const silentlyIgnoredDirs = ['.git', '.svn', '.hg', 'node_modules'];

    const globOptions = {
        dot: true,
        ignore: silentlyIgnoredDirs.map((dir) => '**/' + dir),
    };

    let supportedFilesGlob: string;
    const cwd = process.cwd();

    const entries: Array<{ type: 'file' | 'dir' | 'glob'; glob: string; input: string }> = [];

    for (const pattern of context.filePatterns) {
        const stringPattern = pattern.toString();

        const absolutePath = path.resolve(cwd, stringPattern);

        if (containsIgnoredPathSegment(absolutePath, cwd, silentlyIgnoredDirs)) {
            continue;
        }

        const stat = await statSafe(absolutePath);

        if (stat) {
            if (stat.isFile()) {
                entries.push({
                    type: 'file',
                    glob: escapePathForGlob(fixWindowsSlashes(stringPattern)),
                    input: stringPattern,
                });
            } else if (stat.isDirectory()) {
                /*
                1. Remove trailing `/`, `fast-glob` can't find files for `src//*.js` pattern
                2. Cleanup dirname, when glob `src/../*.js` pattern with `fast-glob`,
                  it returns files like 'src/../index.js'
                */
                const relativePath = path.relative(cwd, absolutePath) || '.';
                entries.push({
                    type: 'dir',
                    glob: escapePathForGlob(fixWindowsSlashes(relativePath)) + '/' + getSupportedFilesGlob(),
                    input: stringPattern,
                });
            }
        } else if (stringPattern[0] === '!') {
            // convert negative patterns to `ignore` entries
            globOptions.ignore.push(fixWindowsSlashes(stringPattern.slice(1)));
        } else {
            entries.push({
                type: 'glob',
                glob: fixWindowsSlashes(stringPattern),
                input: stringPattern,
            });
        }
    }

    for (const { type, glob, input } of entries) {
        let result: string[];

        try {
            result = await fastGlob(glob, globOptions);
        } catch (err) {
            /* istanbul ignore next */
            yield { error: `${errorMessages.globError[type]}: ${input}\n${(err as Error).message}` };
            /* istanbul ignore next */
            continue;
        }

        if (result.length > 0) {
            yield* sortPaths(result);
        }
    }

    function getSupportedFilesGlob(): string {
        if (!supportedFilesGlob) {
            const extensions = context.languages.flatMap((lang) => lang.extensions || []);
            const filenames = context.languages.flatMap((lang) => lang.filenames || []);
            supportedFilesGlob = `**/{${[
                ...extensions.map((ext) => '*' + (ext[0] === '.' ? ext : '.' + ext)),
                ...filenames,
            ]}}`;
        }
        return supportedFilesGlob;
    }
}

const errorMessages = {
    globError: {
        file: 'Unable to resolve file',
        dir: 'Unable to expand directory',
        glob: 'Unable to expand glob pattern',
    },
    emptyResults: {
        file: 'Explicitly specified file was ignored due to negative glob patterns',
        dir: 'No supported files were found in the directory',
        glob: 'No files matching the pattern were found',
    },
};

/**
 * @param {string} absolutePath
 * @param {string} cwd
 * @param {string[]} ignoredDirectories
 */
function containsIgnoredPathSegment(absolutePath: string, cwd: string, ignoredDirectories: string[]): boolean {
    return path
        .relative(cwd, absolutePath)
        .split(path.sep)
        .some((dir) => ignoredDirectories.includes(dir));
}

/**
 * @param {string[]} paths
 */
function sortPaths(paths: string[]): string[] {
    return paths.sort((a, b) => a.localeCompare(b));
}

/**
 * This function should be replaced with `fastGlob.escapePath` when these issues are fixed:
 * - https://github.com/mrmlnc/fast-glob/issues/261
 * - https://github.com/mrmlnc/fast-glob/issues/262
 * @param {string} path
 */
function escapePathForGlob(path: string): string {
    return fastGlob
        .escapePath(
            path.replace(/\\/g, '\0'), // Workaround for fast-glob#262 (part 1)
        )
        .replace(/\\!/g, '@(!)') // Workaround for fast-glob#261
        .replace(/\0/g, '@(\\\\)'); // Workaround for fast-glob#262 (part 2)
}

const isWindows = path.sep === '\\';

/**
 * Using backslashes in globs is probably not okay, but not accepting
 * backslashes as path separators on Windows is even more not okay.
 * https://github.com/prettier/prettier/pull/6776#discussion_r380723717
 * https://github.com/mrmlnc/fast-glob#how-to-write-patterns-on-windows
 * @param {string} pattern
 */
export function fixWindowsSlashes(pattern: string): string {
    return isWindows ? pattern.replace(/\\/g, '/') : pattern;
}
