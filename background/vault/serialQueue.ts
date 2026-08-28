// A tiny FIFO async serializing queue -- each enqueued task starts only
// after the previous one settles, and a failed task never blocks the queue
// for good (the queue variable itself swallows errors; the promise returned
// to each caller does not, and still rejects). Extracted once
// background/vault/storage.ts's writeQueue and background/vault/setup.ts's
// firstVaultWriteQueue independently reimplemented the identical pattern (a
// /code-review finding on M7) -- both, plus salt.ts's own serialization,
// now share this one implementation instead of drifting separately.
export function createSerialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let queue: Promise<unknown> = Promise.resolve();
  return function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = queue.then(task);
    queue = result.catch(() => {});
    return result;
  };
}
