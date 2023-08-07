import * as prettier from 'prettier';
import Piscina from 'piscina';
import { readFileSync, writeFileSync } from 'node:fs';

export async function write(filepath: string): Promise<boolean> {
    const original = readFileSync(filepath, { encoding: 'utf-8' });

    const result = await prettier.format(original, { ...Piscina.workerData, filepath });

    if (original !== result) {
        writeFileSync(filepath, result, { encoding: 'utf-8' });
        return true;
    }

    return false;
}

export function check(filepath: string): Promise<boolean> {
    return prettier.check(readFileSync(filepath, { encoding: 'utf-8' }), { ...Piscina.workerData, filepath });
}
