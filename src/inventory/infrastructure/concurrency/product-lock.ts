/** Serialises tasks that share a key. Implemented by KeyedMutex; swappable for tests or a distributed lock. */
export interface ProductLock {
  runExclusive<T>(key: string, task: () => Promise<T>): Promise<T>;
}
