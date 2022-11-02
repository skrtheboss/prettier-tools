import prettyMilliseconds from 'pretty-ms';

export class ETA {
    private readonly etaBufferLength: number;
    private valueBuffer: number[];
    private timeBuffer: number[];
    private eta = '0';
    private vt_rate = 0;

    constructor(length: number, initTime: number, initValue: number) {
        // size of eta buffer
        this.etaBufferLength = length;

        // eta buffer with initial values
        this.valueBuffer = [initValue];
        this.timeBuffer = [initTime];
    }

    // add new values to calculation buffer
    public update(time: number, value: number, total: number) {
        this.valueBuffer.push(value);
        this.timeBuffer.push(time);

        // trigger recalculation
        this.calculate(total - value);
    }

    // fetch estimated time
    public getTime(): string {
        return this.eta;
    }

    // fetch estimates rate
    public getRate(): number {
        return this.vt_rate;
    }

    // eta calculation - request number of remaining events
    private calculate(remaining: number) {
        // get number of samples in eta buffer
        const currentBufferSize = this.valueBuffer.length;
        const buffer = Math.min(this.etaBufferLength, currentBufferSize);

        const v_diff = this.valueBuffer[currentBufferSize - 1] - this.valueBuffer[currentBufferSize - buffer];
        const t_diff = this.timeBuffer[currentBufferSize - 1] - this.timeBuffer[currentBufferSize - buffer];

        // get progress per ms
        this.vt_rate = v_diff / t_diff;

        // strip past elements
        this.valueBuffer = this.valueBuffer.slice(-this.etaBufferLength);
        this.timeBuffer = this.timeBuffer.slice(-this.etaBufferLength);

        // eq: vt_rate *x = total
        const eta = Math.ceil(remaining / this.vt_rate);

        // check values
        if (Number.isNaN(eta)) {
            this.eta = 'NULL';

            // +/- Infinity --- NaN already handled
        } else if (!Number.isFinite(eta)) {
            this.eta = 'INF';

            // > 10M s ? - set upper display limit ~115days (1e7/60/60/24)
        } else if (eta > 1e7) {
            this.eta = 'INF';

            // negative ?
        } else if (eta < 0) {
            this.eta = prettyMilliseconds(0);
        } else {
            // assign
            this.eta = prettyMilliseconds(eta);
        }
    }
}
