/**
 * A view over a committed table that buffers writes until `commit()`.
 * This gives the in-memory adapter the same all-or-nothing behaviour as a
 * database transaction.
 */
export class StagedTable<T> {
  private readonly pending = new Map<string, T>();

  constructor(private readonly committed: Map<string, T>) {}

  get(id: string): T | undefined {
    return this.pending.get(id) ?? this.committed.get(id);
  }

  set(id: string, row: T): void {
    this.pending.set(id, row);
  }

  /** All rows as seen by this transaction (pending writes win). */
  *rows(): IterableIterator<T> {
    for (const [id, row] of this.committed) {
      if (!this.pending.has(id)) yield row;
    }
    yield* this.pending.values();
  }

  /** Applies buffered writes. Synchronous, so it can never interleave with another commit. */
  commit(): void {
    for (const [id, row] of this.pending) {
      this.committed.set(id, row);
    }
    this.pending.clear();
  }
}
