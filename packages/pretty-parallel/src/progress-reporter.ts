import ora from 'ora';
import prettyMilliseconds from 'pretty-ms';
import { ETA } from './eta';

export class ProgressReporter {
    private readonly checkFilesStart: number;
    private readonly checkFiles: ora.Ora;
    private readonly message: string;
    private readonly eta: ETA;

    private processed = 0;

    constructor(private readonly totalCount: number, private readonly type: 'check' | 'write') {
        this.message = type === 'check' ? 'Checking formatting' : 'Writing formatting';

        this.checkFilesStart = Date.now();
        this.checkFiles = ora(`${this.message} 0% | 0/${totalCount}`).start();

        this.eta = new ETA(totalCount, this.checkFilesStart, 0);
    }

    public update(processed: number): void {
        const now = Date.now();

        this.processed = processed;

        this.eta.update(now, this.processed, this.totalCount);

        const percent = Math.floor((this.processed / this.totalCount) * 100);
        const elapsedMs = now - this.checkFilesStart;

        this.checkFiles.text = `${this.message}\t${percent}% | ${this.processed}/${
            this.totalCount
        }  | ETA: ${this.eta.getTime()} | Elapsed: ${prettyMilliseconds(elapsedMs)} | ${(
            this.eta.getRate() * 1_000
        ).toFixed(0)} files/s`;
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
