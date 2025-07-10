export class MedianPassFilter {
    k: number;
    buffer: number [];
    sorted: number [];
    nextIdx: number;
    previous: number;

  constructor(windowSize = 3) {
    if (windowSize < 1 || windowSize % 2 === 0) {
      throw new Error('windowSize must be an odd integer ≥ 1');
    }
    this.k = windowSize;
    this.buffer = [];
    this.sorted = [];
    this.nextIdx = 0;    // circular index into buffer
  }

  // binary‐search insertion index (like Python's bisect_left)
  _bisectLeft(arr, val) {
    let lo = 0, hi = arr.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (arr[mid] < val) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  process(sample) {
    // If buffer isn't full yet, just add
    if (this.buffer.length < this.k) {
      this.buffer.push(sample);
      // insert into sorted array
      const i = this._bisectLeft(this.sorted, sample);
      this.sorted.splice(i, 0, sample);
    } else {
      // replace the oldest sample in buffer
      const old = this.buffer[this.nextIdx];
      this.buffer[this.nextIdx] = sample;
      this.nextIdx = (this.nextIdx + 1) % this.k;

      // remove old from sorted[]
      let remIdx = this._bisectLeft(this.sorted, old);
      // in case of duplicates, make sure we remove one matching value
      while (this.sorted[remIdx] !== old && remIdx < this.sorted.length) {
        remIdx++;
      }
      this.sorted.splice(remIdx, 1);

      // insert new sample into sorted[]
      const insIdx = this._bisectLeft(this.sorted, sample);
      this.sorted.splice(insIdx, 0, sample);
    }

    // compute median of sorted[]
    const n = this.sorted.length;
    const mid = Math.floor(n / 2);
    if (n % 2 === 1) {
        if(!this.previous) {
            this.previous = this.sorted[mid];
        }
        console.log("A: ", this.previous - this.sorted[mid]);
        this.previous = this.sorted[mid];
        return this.sorted[mid];
    } else {
      // even-length window only happens while buffer fills up
        if(!this.previous) {
            this.previous =  0.5 * (this.sorted[mid - 1] + this.sorted[mid]);
        }
        this.previous =  0.5 * (this.sorted[mid - 1] + this.sorted[mid]);
        return 0.5 * (this.sorted[mid - 1] + this.sorted[mid]);
    }
  }
}
