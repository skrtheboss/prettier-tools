import { expandPatterns, fixWindowsSlashes } from './expand-patterns';
import * as prettier from 'prettier';
import { createIgnorer } from './create-ignorer';

interface ResolveFilePathsResult {
    readonly filePaths: ReadonlyArray<string>;
    readonly errors: ReadonlyArray<string>;
}

export async function resolveFilePaths(
    filePatterns: ReadonlyArray<string | number>,
    prettierignorePath: string
): Promise<ResolveFilePathsResult> {
    const filePaths: string[] = [];
    const errors: string[] = [];

    const ignorer = createIgnorer(prettierignorePath);

    for await (const filePath of expandPatterns({
        filePatterns,
        languages: prettier.getSupportInfo().languages,
    })) {
        if (typeof filePath === 'object') {
            errors.push(filePath.error);
        } else if (ignorer(fixWindowsSlashes(filePath))) {
            filePaths.push(filePath);
        }
    }

    return { filePaths, errors };
}
