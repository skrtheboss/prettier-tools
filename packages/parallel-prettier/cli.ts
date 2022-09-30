#!/usr/bin/env node
import yargs from 'yargs';
import os from 'node:os';
import { hideBin } from 'yargs/helpers';

import { processParallel } from './src';

const parseArgv = yargs(hideBin(process.argv))
    .scriptName('parallel-prettier')
    .usage(
        'Usage: parallel-prettier [processing options] [options] [file/dir/glob ...]\n Example: parallel-prettier --max-workers=6 -c **/*.ts'
    )
    .default({})
    .option('w', {
        describe: 'Edit files in-place. (Beware!)',
        alias: 'write',
        group: 'Output options:',
        conflicts: 'c',
        type: 'array',
    })
    .option('c', {
        describe:
            'Check if the given files are formatted, print a human-friendly summary message and paths to unformatted files',
        alias: 'check',
        group: 'Output options:',
        conflicts: 'w',
        type: 'array',
    })
    .option('max-workers', {
        describe:
            'Specifies the maximum number of workers the worker-pool will spawn for running prettier. In single run mode, this defaults to the number of the cores available on your machine.',
        group: 'Processing options:',
        default: os.cpus().length,
        type: 'number',
        nargs: 1,
    })
    .strict()
    .help(true);

async function main(): Promise<void> {
    const parsedArguments = parseArgv.parseSync();

    if (parsedArguments.c?.length) {
        await processParallel('check', parsedArguments.c, parsedArguments.maxWorkers);
    } else if (parsedArguments.w?.length) {
        await processParallel('write', parsedArguments.w, parsedArguments.maxWorkers);
    } else {
        parseArgv.showHelp();
        process.exit(1);
    }
}

main();
