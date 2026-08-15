export class PendingNonceManager {
  private nextNonce: number | undefined;
  private lock: Promise<void> = Promise.resolve();

  constructor(private readonly fetchPendingNonce: () => Promise<number>) {}

  async reserve(): Promise<number> {
    const previous = this.lock;
    let release!: () => void;
    this.lock = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      if (this.nextNonce === undefined) this.nextNonce = await this.fetchPendingNonce();
      return this.nextNonce++;
    } finally {
      release();
    }
  }

  reset(): void {
    this.nextNonce = undefined;
  }
}
