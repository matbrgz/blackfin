// The request-correlation bookkeeping the main process keeps (#61): a table of
// in-flight CLI requests, each awaiting exactly one renderer response, keyed by
// requestId. Pure and I/O-free — the socket and the timer live in the server;
// this owns the rule the issue is explicit about: "a requestId that is unknown,
// duplicate, or arrives after the timeout is discarded, never written to a
// socket." Modelling it separately means that rule is unit-tested rather than
// buried in socket callbacks.

/**
 * A map of pending requests to their settle callbacks. `T` is whatever the
 * server settles with (in practice the socket + timer to clean up).
 */
export class PendingRequests<T> {
  private readonly entries = new Map<string, T>()

  /**
   * Register a new in-flight request. Returns `false` — and registers nothing —
   * if the id is already pending, so a duplicate id can never overwrite and
   * strand the first request.
   */
  public register(id: string, value: T): boolean {
    if (this.entries.has(id)) {
      return false
    }
    this.entries.set(id, value)
    return true
  }

  /**
   * Take and remove the entry for an id, or `undefined` if there is none. A
   * response for an unknown, already-settled, or timed-out id therefore yields
   * `undefined`, and the caller writes nothing — exactly the discard rule.
   */
  public settle(id: string): T | undefined {
    const value = this.entries.get(id)
    if (value === undefined) {
      return undefined
    }
    this.entries.delete(id)
    return value
  }

  public has(id: string): boolean {
    return this.entries.has(id)
  }

  public get size(): number {
    return this.entries.size
  }

  /** Take and remove every pending entry — for shutting the server down. */
  public drain(): ReadonlyArray<T> {
    const all = [...this.entries.values()]
    this.entries.clear()
    return all
  }
}
