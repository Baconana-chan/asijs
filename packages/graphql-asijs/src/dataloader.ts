/**
 * A minimal DataLoader: batches loads within a microtask and caches results
 * per instance (per request). Drop-in for the `dataloader` package for the
 * common single-batch use case — zero dependencies.
 */

export interface DataLoaderOptions<K, V> {
  /** Max keys per batch (default Infinity). */
  maxBatchSize?: number;
  /** Custom cache (Map-like). */
  cacheMap?: Map<K, Promise<V>>;
  /** Disable caching entirely. */
  cache?: boolean;
}

interface BatchEntry<K, V> {
  keys: K[];
  resolve: (values: V[]) => void;
  reject: (error: unknown) => void;
}

interface Batch<K, V> {
  entries: BatchEntry<K, V>[];
  total: number;
}

export class DataLoader<K, V> {
  private readonly batchFn: (keys: readonly K[]) => Promise<readonly (V | Error)[]>;
  private readonly maxBatchSize: number;
  private readonly useCache: boolean;
  private readonly cacheMap: Map<K, Promise<V>>;
  private batch: Batch<K, V> | null = null;

  constructor(
    batchFn: (keys: readonly K[]) => Promise<readonly (V | Error)[]>,
    options: DataLoaderOptions<K, V> = {},
  ) {
    this.batchFn = batchFn;
    this.maxBatchSize = options.maxBatchSize ?? Infinity;
    this.useCache = options.cache ?? true;
    this.cacheMap = options.cacheMap ?? new Map<K, Promise<V>>();
  }

  /** Load a single key (batched). */
  load(key: K): Promise<V> {
    if (this.useCache) {
      const hit = this.cacheMap.get(key);
      if (hit) return hit;
    }
    const promise = this.enqueue([key]).then((values) => values[0]);
    if (this.useCache) this.cacheMap.set(key, promise);
    return promise;
  }

  /** Load many keys in one batch. */
  loadMany(keys: readonly K[]): Promise<(V | Error)[]> {
    const list = [...keys];
    if (list.length === 0) return Promise.resolve([]);
    // Resolve per-key so a failing key rejects only its own promise.
    return Promise.all(list.map((key) => this.load(key).catch((error) => error as Error)));
  }

  /** Remove a key from the cache. */
  clear(key: K): this {
    this.cacheMap.delete(key);
    return this;
  }

  /** Clear the whole cache. */
  clearAll(): this {
    this.cacheMap.clear();
    return this;
  }

  /** Pre-populate the cache. */
  prime(key: K, value: V | Promise<V>): this {
    this.cacheMap.set(key, Promise.resolve(value));
    return this;
  }

  private enqueue(keys: K[]): Promise<V[]> {
    return new Promise<V[]>((resolve, reject) => {
      if (!this.batch || this.batch.total + keys.length > this.maxBatchSize) {
        this.batch = { entries: [], total: 0 };
        queueMicrotask(() => this.dispatch(this.batch!));
      }
      this.batch.entries.push({ keys, resolve, reject });
      this.batch.total += keys.length;
    });
  }

  private async dispatch(batch: Batch<K, V>): Promise<void> {
    this.batch = null;
    const allKeys: K[] = [];
    for (const entry of batch.entries) allKeys.push(...entry.keys);

    let values: readonly (V | Error)[];
    try {
      values = await this.batchFn(allKeys);
    } catch (error) {
      for (const entry of batch.entries) entry.reject(error);
      return;
    }

    if (!Array.isArray(values) || values.length !== allKeys.length) {
      const error = new Error(
        `DataLoader: batch function must return an array of ${allKeys.length} items (got ${values?.length ?? "none"})`,
      );
      for (const entry of batch.entries) entry.reject(error);
      return;
    }

    let idx = 0;
    for (const entry of batch.entries) {
      const slice = values.slice(idx, idx + entry.keys.length);
      idx += entry.keys.length;
      const failing = slice.findIndex((v) => v instanceof Error);
      if (failing !== -1) {
        entry.reject(slice[failing] as Error);
      } else {
        entry.resolve(slice as V[]);
      }
    }
  }
}

export default DataLoader;
