import * as prettier from 'prettier';
import Piscina from 'piscina';
import { readFileSync, writeFileSync } from 'node:fs';

export function format(filepath: string): void {
    const original = readFileSync(filepath, { encoding: 'utf-8' });

    const result = prettier.format(original, { ...Piscina.workerData, filepath });

    if (original !== result) {
        writeFileSync(filepath, result, { encoding: 'utf-8' });
    }
}

export function check(filepath: string): boolean {
    return prettier.check(readFileSync(filepath, { encoding: 'utf-8' }), { ...Piscina.workerData, filepath });
}
