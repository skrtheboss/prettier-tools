import { existsSync, readFileSync } from 'node:fs';

import ignore from 'ignore';

type Ignorer = (filePath: string) => boolean;

export function createIgnorer(prettierignore: string): Ignorer {
    if (existsSync(prettierignore)) {
        return ignore({
            allowRelativePaths: true,
        })
            .add(
                readFileSync(prettierignore, {
                    encoding: 'utf-8',
                }),
            )
            .createFilter();
    }

    return () => true;
}
