import * as prettier from 'prettier';
import ignore from 'ignore';
import { promises as fs } from 'fs';
import Piscina from 'piscina';
import ora from 'ora';

const path = require('path');
const fastGlob = require('fast-glob');

/** @typedef {import('./context').Context} Context */

/**
 * @param {Context} context
 */
async function* expandPatterns(context) {
    const cwd = process.cwd();
    const seen = new Set();
    let noResults = true;

    for await (const pathOrError of expandPatternsInternal(context)) {
        noResults = false;
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

    if (noResults && context.argv.errorOnUnmatchedPattern !== false) {
        // If there was no files and no other errors, let's yield a general error.
        yield {
            error: `No matching files. Patterns: ${context.filePatterns.join(' ')}`,
        };
    }
}

async function statSafe(filePath) {
    try {
        return await fs.stat(filePath);
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
    }
}

/**
 * @param {Context} context
 */
async function* expandPatternsInternal(context) {
    // Ignores files in version control systems directories and `node_modules`
    const silentlyIgnoredDirs = ['.git', '.svn', '.hg'];
    if (context.argv.withNodeModules !== true) {
        silentlyIgnoredDirs.push('node_modules');
    }
    const globOptions = {
        dot: true,
        ignore: silentlyIgnoredDirs.map(dir => '**/' + dir),
    };

    let supportedFilesGlob;
    const cwd = process.cwd();

    /** @type {Array<{ type: 'file' | 'dir' | 'glob'; glob: string; input: string; }>} */
    const entries = [];

    for (const pattern of context.filePatterns) {
        const absolutePath = path.resolve(cwd, pattern);

        if (containsIgnoredPathSegment(absolutePath, cwd, silentlyIgnoredDirs)) {
            continue;
        }

        const stat = await statSafe(absolutePath);
        if (stat) {
            if (stat.isFile()) {
                entries.push({
                    type: 'file',
                    glob: escapePathForGlob(fixWindowsSlashes(pattern)),
                    input: pattern,
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
                    input: pattern,
                });
            }
        } else if (pattern[0] === '!') {
            // convert negative patterns to `ignore` entries
            globOptions.ignore.push(fixWindowsSlashes(pattern.slice(1)));
        } else {
            entries.push({
                type: 'glob',
                glob: fixWindowsSlashes(pattern),
                input: pattern,
            });
        }
    }

    for (const { type, glob, input } of entries) {
        let result;

        try {
            result = await fastGlob(glob, globOptions);
        } catch ({ message }) {
            /* istanbul ignore next */
            yield { error: `${errorMessages.globError[type]}: ${input}\n${message}` };
            /* istanbul ignore next */
            continue;
        }

        if (result.length === 0) {
            if (context.argv.errorOnUnmatchedPattern !== false) {
                yield { error: `${errorMessages.emptyResults[type]}: "${input}".` };
            }
        } else {
            yield* sortPaths(result);
        }
    }

    function getSupportedFilesGlob() {
        if (!supportedFilesGlob) {
            const extensions = context.languages.flatMap(lang => lang.extensions || []);
            const filenames = context.languages.flatMap(lang => lang.filenames || []);
            supportedFilesGlob = `**/{${[
                ...extensions.map(ext => '*' + (ext[0] === '.' ? ext : '.' + ext)),
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
function containsIgnoredPathSegment(absolutePath, cwd, ignoredDirectories) {
    return path
        .relative(cwd, absolutePath)
        .split(path.sep)
        .some(dir => ignoredDirectories.includes(dir));
}

/**
 * @param {string[]} paths
 */
function sortPaths(paths) {
    return paths.sort((a, b) => a.localeCompare(b));
}

/**
 * This function should be replaced with `fastGlob.escapePath` when these issues are fixed:
 * - https://github.com/mrmlnc/fast-glob/issues/261
 * - https://github.com/mrmlnc/fast-glob/issues/262
 * @param {string} path
 */
function escapePathForGlob(path) {
    return fastGlob
        .escapePath(
            path.replace(/\\/g, '\0') // Workaround for fast-glob#262 (part 1)
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
function fixWindowsSlashes(pattern) {
    return isWindows ? pattern.replace(/\\/g, '/') : pattern;
}

class WorkerError extends Error {
    constructor(public readonly filePath: string, public readonly error: Error) {
        super();
        Object.setPrototypeOf(this, WorkerError.prototype);
    }
}

async function test(type: 'check' | 'format'): Promise<void> {
    const fileStructureLoadingSpinner = ora('Loading file structure').start();

    const start = Date.now();

    const paths: Array<{ readonly filePath: string; readonly parser?: string }> = [];

    const ignorer = ignore({ allowRelativePaths: true }).add(
        await fs.readFile('.prettierignore', { encoding: 'utf-8' })
    );

    for await (const filePath of expandPatterns({
        argv: {},
        filePatterns: ['.'],
        languages: prettier.getSupportInfo().languages,
    })) {
        if (!ignorer.ignores(filePath)) {
            paths.push({ filePath });
        }
    }

    fileStructureLoadingSpinner.info(`Found ${paths.length} files [${Date.now() - start}ms]`);

    const checkFiles = ora(
        `${type === 'check' ? 'Checking formatting' : 'Writing formatting'} 0% - (0/${paths.length})`
    ).start();
    const checkFilesStart = Date.now();

    const options = await prettier.resolveConfig('.prettierrc', { editorconfig: true });

    const piscina = new Piscina({
        // The URL must be a file:// URL
        filename: path.resolve(__dirname, 'test-worker.js'),
        maxThreads: 1,
        workerData: options,
    });

    try {
        setInterval(() => {
            const percent = Math.floor((piscina.completed / paths.length) * 100);
            const elapsed = (Date.now() - checkFilesStart) / 1_000;
            const etaSeconds = (percent == 100 ? 0 : elapsed * (paths.length / piscina.completed - 1)).toFixed(1);
            const filesPerSeconds = (piscina.completed / elapsed).toFixed(0);
            checkFiles.text = `${type === 'check' ? 'Checking formatting' : 'Writing formatting'} ${percent}% - (${
                piscina.completed
            }/${paths.length}) elapsed ${elapsed.toFixed(1)}s remaining ${etaSeconds}s rate ${filesPerSeconds} files/s`;
        }, 100);

        const tasks: Array<Promise<{ result: boolean | void; filePath: string }>> = [];

        for (const { filePath } of paths) {
            tasks.push(
                piscina
                    .run(filePath, { name: type })
                    .then(result => ({ result, filePath }))
                    .catch(err => {
                        throw new WorkerError(filePath, err);
                    })
            );
        }

        const result = await Promise.all(tasks);

        const failures = result.filter(c => c.result === false);

        if (failures.length > 0) {
            checkFiles.fail(`Code style issues found in ${failures.length} files. Forgot to run Prettier?`);
            failures.forEach(f => console.log(`- ${f.filePath}`));
            process.exit(1);
        } else {
            checkFiles.succeed(`Successfully ${type === 'check' ? 'checked' : 'formatted'} ${paths.length} files!`);
            process.exit(0);
        }
    } catch (err) {
        if (err instanceof WorkerError) {
            checkFiles.fail(`An error occurred while parsing file '${err.filePath}'!`);
            console.error(err.error);
            process.exit(1);
        } else {
            throw err;
        }
    }

    console.log(`Total time ${(Date.now() - start) / 1_000}s`);
}

test('check').catch(err => {
    console.error('An unknown error has occurred!');
    console.error(err);
    process.exit(1);
});
