type Task<T> = () => Promise<T>;

function createLimiter(maxConcurrent: number) {
  let active = 0;
  const queue: Array<{
    run: () => void;
    reject: (err: unknown) => void;
  }> = [];

  const dequeue = () => {
    if (active >= maxConcurrent) return;
    const next = queue.shift();
    if (!next) return;
    active += 1;
    next.run();
  };

  return async function limit<T>(task: Task<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = async () => {
        try {
          const result = await task();
          resolve(result);
        } catch (err) {
          reject(err);
        } finally {
          active -= 1;
          dequeue();
        }
      };

      queue.push({ run, reject });
      dequeue();
    });
  };
}

export const limiters = {
  llm: createLimiter(10),
  image: createLimiter(5),
  video: createLimiter(3),
};

