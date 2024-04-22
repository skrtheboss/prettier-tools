import path from 'node:path';

import chalk from 'chalk';
import ora from 'ora';
import Piscina from 'piscina';
import * as prettier from 'prettier';
import prettyMilliseconds from 'pretty-ms';

import { resolveFilePaths } from './files-resolver';
import { ProgressReporter } from './progress-reporter';

class WorkerError extends Error {
    constructor(
        public readonly filePath: string,
        public readonly error: Error,
    ) {
        super();
        Object.setPrototypeOf(this, WorkerError.prototype);
    }
}

interface Options {
    readonly filePatterns: ReadonlyArray<string | number>;
    readonly workingDir: string;
    readonly maxWorkers: number;
    readonly config?: string;
}

export async function processParallel(
    type: 'check' | 'write',
    { filePatterns, workingDir, maxWorkers, config }: Options,
): Promise<void> {
    const resolveFilesStart = Date.now();

    const prettierIgnorePath = path.resolve(path.join(workingDir, '.prettierignore'));
    const packageJsonPath = path.join(workingDir, 'package.json');
    const prettierConfigPath = config || (await prettier.resolveConfigFile(packageJsonPath));
    const prettierOptions =
        prettierConfigPath &&
        (await prettier.resolveConfig(packageJsonPath, {
            config: prettierConfigPath,
            editorconfig: true,
        }));

    const fileStructureLoadingSpinner = ora('Loading file structure').start();

    const { filePaths } = await resolveFilePaths(filePatterns, prettierIgnorePath);

    fileStructureLoadingSpinner.info(
        `Found ${chalk.bold(filePaths.length)} ${filePaths.length === 1 ? 'file' : 'files'} [${prettyMilliseconds(
            Date.now() - resolveFilesStart,
        )}]`,
    );

    const prettierStart = Date.now();

    const piscina = new Piscina({
        filename: path.resolve(__dirname, 'worker.js'),
        maxThreads: maxWorkers,
        workerData: prettierOptions,
    });

    const reporter = new ProgressReporter(filePaths.length, type);

    try {
        const tasks: Array<
            Promise<{
                result: boolean | void;
                filePath: string;
            }>
        > = [];

        for (const filePath of filePaths) {
            tasks.push(
                piscina
                    .run(filePath, { name: type })
                    .then((result) => ({
                        result,
                        filePath,
                    }))
                    .catch((err) => {
                        throw new WorkerError(filePath, err);
                    })
                    .finally(() => reporter.update(piscina.completed)),
            );
        }

        const result = await Promise.all(tasks);

        if (type === 'check') {
            const checkFailures = result.filter((c) => c.result === false);

            if (checkFailures.length > 0) {
                checkFailures.forEach(({ filePath }) => reporter.warn(`Check failed: ${chalk.bold(filePath)}`));
                reporter.fail(
                    `Code style issues found in the ${chalk.bold(checkFailures.length)} ${
                        checkFailures.length === 1 ? 'file' : 'files'
                    } above. Forgot to run Prettier? [${prettyMilliseconds(Date.now() - prettierStart)}]`,
                );
                process.exit(1);
            } else {
                reporter.succeed(
                    `Successfully checked ${chalk.bold(filePaths.length)} ${
                        filePaths.length === 1 ? 'file' : 'files'
                    }! [${prettyMilliseconds(Date.now() - prettierStart)}]`,
                );
                process.exit(0);
            }
        } else {
            result.forEach(({ filePath, result }) => result && reporter.succeed(`Fixed up ${chalk.bold(filePath)}`));
            reporter.succeed(
                `Successfully formatted ${chalk.bold(filePaths.length)} ${
                    filePaths.length === 1 ? 'file' : 'files'
                }! [${prettyMilliseconds(Date.now() - prettierStart)}]`,
            );
            process.exit(0);
        }
    } catch (err) {
        if (err instanceof WorkerError) {
            reporter.fail(`An error occurred while parsing file '${err.filePath}'!`);
            console.error(err.error);
            process.exit(1);
        } else {
            throw err;
        }
    }

    console.log(`Total time ${(Date.now() - resolveFilesStart) / 1000}s `);
}
