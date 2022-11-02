import ignore from 'ignore';
import { existsSync, readFileSync } from 'node:fs';

type Ignorer = (filePath: string) => boolean;

export function createIgnorer(prettierignore: string): Ignorer {
    if (existsSync(prettierignore)) {
        return ignore({ allowRelativePaths: true })
            .add(readFileSync(prettierignore, { encoding: 'utf-8' }))
            .createFilter();
    }

    return () => true;
}
