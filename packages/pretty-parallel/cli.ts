#!/usr/bin/env node
import os from 'node:os';

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { processParallel } from './src';

const parseArgv = yargs(hideBin(process.argv))
    .env('PRETTY_PARALLEL')
    .scriptName('pretty-parallel')
    .usage(
        'Usage: pretty-parallel [processing options] [options] [file/dir/glob ...]\n Example: pretty-parallel --max-workers=6 -c **/*.ts',
    )
    .default({})
    .option('config', {
        describe: 'Path to a Prettier configuration file (.prettierrc, package.json, prettier.config.js).',
        type: 'string',
    })
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
    const { maxWorkers, c, w, config } = parseArgv.parseSync();
    const workingDir = process.cwd();

    if (c?.length) {
        await processParallel('check', {
            filePatterns: c,
            workingDir,
            maxWorkers,
            config,
        });
    } else if (w?.length) {
        await processParallel('write', {
            filePatterns: w,
            workingDir,
            maxWorkers,
            config,
        });
    } else {
        parseArgv.showHelp();
        process.exit(1);
    }
}

main();
