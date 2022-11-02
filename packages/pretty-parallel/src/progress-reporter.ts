import ora from 'ora';
import prettyMilliseconds from 'pretty-ms';

export class ProgressReporter {
    private readonly checkFilesStart = Date.now();
    private readonly checkFiles: ora.Ora;
    private readonly message: string;

    private processed = 0;

    constructor(private readonly totalCount: number, private readonly type: 'check' | 'write') {
        this.message = type === 'check' ? 'Checking formatting' : 'Writing formatting';

        this.checkFiles = ora(`${this.message} 0% | 0/${totalCount}`).start();
    }

    public update(processed: number): void {
        this.processed = processed;

        const percent = Math.floor((this.processed / this.totalCount) * 100);
        const elapsedMs = Date.now() - this.checkFilesStart;
        const etaMs = percent == 100 ? 0 : elapsedMs * (this.totalCount / Math.min(this.processed, 1));
        const filesPerSeconds = (this.processed / (elapsedMs / 1_000)).toFixed(0);

        this.checkFiles.text = `${this.message}\t${percent}% | ${this.processed}/${
            this.totalCount
        }  | ETA: ${prettyMilliseconds(etaMs)} | Elapsed: ${prettyMilliseconds(
            elapsedMs
        )} | ${filesPerSeconds} files/s`;
    }

    public fail(message: string): void {
        this.checkFiles.fail(message);
    }

    public warn(message: string): void {
        this.checkFiles.warn(message);
    }

    public succeed(message: string): void {
        this.checkFiles.succeed(message);
    }
}
