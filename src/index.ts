/**
 * Sleep utility function
 * @param ms - Milliseconds to sleep
 * @returns Promise that resolves after the specified time
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(), ms);
  });
}

/**
 * Extract return type from an async function
 */
export type AsyncReturnType<T extends (...args: any) => Promise<any>> =
  T extends (...args: any) => Promise<infer R> ? R : any;

/**
 * Generate a unique task ID
 */
function generateTaskUniqueId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * Async Task Runner interface
 */
export interface AsyncTaskRunner {
  addTask: (task: () => Promise<any>, priority?: number) => void;
  finishAll: () => Promise<void>;
  logProgress: (...logSuffixes: string[]) => void;
}

interface AsyncTask {
  task: () => Promise<any>;
  priority?: number;
  time: number;
}

/**
 * Configuration options for the async task runner
 */
export interface AsyncTaskRunnerOptions {
  /** Maximum number of tasks to run in parallel (default: 20) */
  maxInParallel?: number;
  /** Tick interval in milliseconds (default: 10) */
  tickInterval?: number;
  /** Log progress every N finished tasks */
  logProgressWhenFinishing?: number;
  /** Expiration time in milliseconds - runner will stop accepting new tasks after this time */
  expirationTime?: number;
}

/**
 * Creates an async task runner with pooling and throttling capabilities
 *
 * Why use this instead of Promise.all()?
 * - Promise.all() has no control over concurrency - all promises start immediately
 * - This runner controls the maximum number of parallel tasks (pooling)
 * - Supports task prioritization
 * - Provides progress tracking and logging
 * - Handles throttling to prevent overwhelming resources
 * - Supports expiration time to stop processing after a deadline
 *
 * @param taskName - Name for logging purposes
 * @param options - Configuration options
 * @returns AsyncTaskRunner instance
 */
export function createAsyncTasksRunner(
  taskName: string,
  options?: AsyncTaskRunnerOptions
): AsyncTaskRunner {
  const tickInterval = options?.tickInterval || 10;
  const maxInParallel = options?.maxInParallel || 20;
  const logProgressWhenFinishing = options?.logProgressWhenFinishing;
  const expirationTime = options?.expirationTime;

  const state = {
    lastLogProgressWhenFinishing: 0,
    finishedCounter: 0,
    finishedChangeTime: 0,
    pendingCounter: 0,
    pendingChangeTime: 0,
    runningCounter: 0,
    runningChangeTime: 0,
    isWaitingToFinish: false,
  };
  const pendingTasks: { [taskUniqueId: string]: AsyncTask } = {};

  const logProgress: AsyncTaskRunner["logProgress"] = (...logSuffixes) => {
    const finishedCounterSnapshot = state.finishedCounter;
    const pendingCounterSnapshot = state.pendingCounter;
    const runningCounterSnapshot = state.runningCounter;
    const totalCounterSnapshot =
      finishedCounterSnapshot + pendingCounterSnapshot + runningCounterSnapshot;
    console.log(
      `${taskName} progress: ${finishedCounterSnapshot} of ${totalCounterSnapshot}(p: ${pendingCounterSnapshot} | r: ${runningCounterSnapshot}) finishes!`,
      ...logSuffixes
    );
  };
  const logFinish = () => {
    console.log(`${taskName} finished! ${state.finishedCounter} tasks`);
  };

  const startRunner = async (): Promise<any> => {
    while (true) {
      // should log progress?
      const lastLogFinishedDiff =
        state.finishedCounter - state.lastLogProgressWhenFinishing;
      if (lastLogFinishedDiff > (logProgressWhenFinishing || 0)) {
        state.lastLogProgressWhenFinishing = state.finishedCounter;
        logProgress();
      }

      // nothing pending or running? finish or next tick
      if (!state.pendingCounter) {
        if (!state.runningCounter && state.isWaitingToFinish) return;
        await sleep(tickInterval);
        continue;
      }

      // stop running more tasks when expirationTime has been reached
      if (expirationTime && Date.now() >= expirationTime) {
        if (state.runningCounter) {
          await sleep(tickInterval);
          continue;
        }
        if (!state.runningCounter) return;
      }

      // running at maximum capacity? next tick
      if (state.runningCounter >= maxInParallel) {
        await sleep(tickInterval);
        continue;
      }
      state.runningChangeTime = Date.now();

      // Sort pending tasks by priority (descending) and time (ascending - oldest first)
      const nextQueue = Object.entries(pendingTasks)
        .map(([id, t]) => ({
          id,
          t,
          p: t.priority || 0,
          o: t.time,
        }))
        .sort((a, b) => {
          // First sort by priority (higher priority first)
          if (b.p !== a.p) return b.p - a.p;
          // Then by time (older tasks first)
          return a.o - b.o;
        });

      let nextQueueIndex = 0;
      while (!!state.pendingCounter && state.runningCounter < maxInParallel) {
        // pick next enqueued task by priority and order, start to run it attaching finish instructions
        const taskUniqueId = nextQueue[nextQueueIndex]?.id;
        const task = nextQueue[nextQueueIndex]?.t.task;
        if (!taskUniqueId || !task) break;
        state.runningCounter++;
        delete pendingTasks[taskUniqueId];
        state.pendingCounter--;
        task()
          .catch((error) => {
            console.error(
              taskName,
              "single task failed unexpectedly!",
              taskUniqueId,
              error
            );
          })
          .finally(() => {
            state.finishedCounter++;
            state.finishedChangeTime = Date.now();
            state.runningCounter--;
          });
        nextQueueIndex++;
      }
      await sleep(tickInterval);
    }
  };
  const runner = startRunner().catch((error) => {
    console.error(
      taskName,
      "failed unexpectedly! Async task runner failure",
      error
    );
  });

  const addTask: AsyncTaskRunner["addTask"] = (task, priority) => {
    const taskUniqueId = generateTaskUniqueId();
    const time = Date.now();
    const asyncTask: AsyncTask = { task, time };
    if (priority) asyncTask.priority = priority;
    pendingTasks[taskUniqueId] = asyncTask;
    state.pendingCounter++;
    state.pendingChangeTime = Date.now();
  };
  const finishAll: AsyncTaskRunner["finishAll"] = async () => {
    state.isWaitingToFinish = true;
    await runner;
    logFinish();
  };

  return {
    addTask,
    finishAll,
    logProgress,
  };
}
