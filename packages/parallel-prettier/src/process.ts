import * as prettier from 'prettier';
import ignore from 'ignore';
import fs from 'node:fs/promises';
import path from 'node:path';
import Piscina from 'piscina';
import ora from 'ora';
import { expandPatterns, fixWindowsSlashes } from './expand-patterns';

class WorkerError extends Error {
    constructor(public readonly filePath: string, public readonly error: Error) {
        super();
        Object.setPrototypeOf(this, WorkerError.prototype);
    }
}

export async function processParallel(
    type: 'check' | 'write',
    filePatterns: Array<string | number>,
    maxWorkers: number
): Promise<void> {
    const fileStructureLoadingSpinner = ora('Loading file structure').start();

    const start = Date.now();

    const paths: Array<{ readonly filePath: string; readonly parser?: string }> = [];

    const ignorer = ignore({ allowRelativePaths: true }).add(
        await fs.readFile('.prettierignore', { encoding: 'utf-8' })
    );

    for await (const filePath of expandPatterns({
        filePatterns,
        languages: prettier.getSupportInfo().languages,
    })) {
        if (typeof filePath === 'object') {
            console.log(filePath.error);
        } else if (!ignorer.ignores(fixWindowsSlashes(filePath))) {
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
        filename: path.resolve(__dirname, 'worker.js'),
        maxThreads: maxWorkers,
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
                    .then((result) => ({ result, filePath }))
                    .catch((err) => {
                        throw new WorkerError(filePath, err);
                    })
            );
        }

        const result = await Promise.all(tasks);

        const failures = result.filter((c) => c.result === false);

        if (failures.length > 0) {
            checkFiles.fail(`Code style issues found in ${failures.length} files. Forgot to run Prettier?`);
            failures.forEach((f) => console.log(`- ${f.filePath}`));
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

    console.log(`Total time ${(Date.now() - start) / 1_000}s `);
}
