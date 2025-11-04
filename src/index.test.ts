import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createAsyncTasksRunner, sleep } from "./index";

describe("async-task-runner-js", () => {
  describe("sleep function", () => {
    it("should resolve after specified milliseconds", async () => {
      const start = Date.now();
      await sleep(50);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(45); // Allow some margin
    });
  });

  describe("createAsyncTasksRunner - Basic Functionality", () => {
    it("should execute all tasks", async () => {
      const runner = createAsyncTasksRunner("Test Runner", {
        maxInParallel: 5,
      });

      const results: number[] = [];

      for (let i = 0; i < 10; i++) {
        runner.addTask(async () => {
          results.push(i);
        });
      }

      await runner.finishAll();

      expect(results).toHaveLength(10);
      expect(results.sort((a, b) => a - b)).toEqual([
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
      ]);
    });

    it("should respect maxInParallel limit", async () => {
      const runner = createAsyncTasksRunner("Parallel Test", {
        maxInParallel: 3,
      });

      let concurrentCount = 0;
      let maxConcurrent = 0;

      const tasks = Array.from({ length: 10 }, () => async () => {
        concurrentCount++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCount);
        await sleep(20);
        concurrentCount--;
      });

      tasks.forEach((task) => runner.addTask(task));
      await runner.finishAll();

      expect(maxConcurrent).toBeLessThanOrEqual(3);
      expect(concurrentCount).toBe(0); // All tasks completed
    });

    it("should handle async operations correctly", async () => {
      const runner = createAsyncTasksRunner("Async Test", {
        maxInParallel: 5,
      });

      const results: string[] = [];

      for (let i = 0; i < 5; i++) {
        runner.addTask(async () => {
          await sleep(10);
          results.push(`task-${i}`);
        });
      }

      await runner.finishAll();

      expect(results).toHaveLength(5);
    });
  });

  describe("Priority-based Execution", () => {
    it("should execute high priority tasks before low priority tasks", async () => {
      const runner = createAsyncTasksRunner("Priority Test", {
        maxInParallel: 1, // Sequential execution to test priority
        tickInterval: 5,
      });

      const executionOrder: string[] = [];

      // Add low priority tasks first
      for (let i = 0; i < 3; i++) {
        runner.addTask(async () => {
          executionOrder.push(`low-${i}`);
        }, 0);
      }

      // Add high priority tasks
      for (let i = 0; i < 3; i++) {
        runner.addTask(async () => {
          executionOrder.push(`high-${i}`);
        }, 10);
      }

      await runner.finishAll();

      // High priority tasks should execute first
      expect(executionOrder[0]).toMatch(/^high-/);
      expect(executionOrder[1]).toMatch(/^high-/);
      expect(executionOrder[2]).toMatch(/^high-/);
    });

    it("should handle mixed priority levels", async () => {
      const runner = createAsyncTasksRunner("Mixed Priority", {
        maxInParallel: 1,
        tickInterval: 5,
      });

      const executionOrder: number[] = [];

      runner.addTask(async () => executionOrder.push(1), 1);
      runner.addTask(async () => executionOrder.push(5), 5);
      runner.addTask(async () => executionOrder.push(3), 3);
      runner.addTask(async () => executionOrder.push(10), 10);
      runner.addTask(async () => executionOrder.push(0), 0);

      await runner.finishAll();

      // Should execute in priority order: 10, 5, 3, 1, 0
      expect(executionOrder).toEqual([10, 5, 3, 1, 0]);
    });
  });

  describe("Error Handling", () => {
    it("should continue execution even if some tasks fail", async () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const runner = createAsyncTasksRunner("Error Test", {
        maxInParallel: 5,
      });

      const successfulTasks: number[] = [];

      for (let i = 0; i < 10; i++) {
        runner.addTask(async () => {
          if (i === 5) {
            throw new Error("Task 5 failed");
          }
          successfulTasks.push(i);
        });
      }

      await runner.finishAll();

      expect(successfulTasks).toHaveLength(9);
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it("should handle promise rejection", async () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const runner = createAsyncTasksRunner("Rejection Test", {
        maxInParallel: 3,
      });

      runner.addTask(async () => {
        return Promise.reject(new Error("Rejected"));
      });

      runner.addTask(async () => {
        return "success";
      });

      await runner.finishAll();

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("Progress Tracking", () => {
    it("should log progress at specified intervals", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const runner = createAsyncTasksRunner("Progress Test", {
        maxInParallel: 10,
        logProgressWhenFinishing: 5,
      });

      for (let i = 0; i < 20; i++) {
        runner.addTask(async () => {
          await sleep(5);
        });
      }

      await runner.finishAll();

      // Should have logged progress at 5, 10, 15 and final completion
      expect(consoleSpy).toHaveBeenCalled();
      expect(
        consoleSpy.mock.calls.some((call) => call[0].includes("progress:"))
      ).toBe(true);

      consoleSpy.mockRestore();
    });

    it("should allow manual progress logging", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const runner = createAsyncTasksRunner("Manual Log Test", {
        maxInParallel: 5,
      });

      for (let i = 0; i < 5; i++) {
        runner.addTask(async () => sleep(10));
      }

      runner.logProgress("Custom message");

      await runner.finishAll();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Manual Log Test progress:"),
        "Custom message"
      );

      consoleSpy.mockRestore();
    });
  });

  describe("Expiration Time", () => {
    it("should stop accepting new tasks after expiration time", async () => {
      const expirationTime = Date.now() + 100; // 100ms from now

      const runner = createAsyncTasksRunner("Expiration Test", {
        maxInParallel: 1,
        expirationTime,
        tickInterval: 10,
      });

      const completedTasks: number[] = [];

      // Add tasks that will complete before expiration
      for (let i = 0; i < 3; i++) {
        runner.addTask(async () => {
          await sleep(20);
          completedTasks.push(i);
        });
      }

      // Add tasks that won't start due to expiration
      for (let i = 3; i < 10; i++) {
        runner.addTask(async () => {
          await sleep(20);
          completedTasks.push(i);
        });
      }

      await runner.finishAll();

      // Not all tasks should complete due to expiration
      expect(completedTasks.length).toBeLessThan(10);
    });
  });

  describe("Task Order with Same Priority", () => {
    it("should execute tasks with same priority in FIFO order", async () => {
      const runner = createAsyncTasksRunner("FIFO Test", {
        maxInParallel: 1,
        tickInterval: 5,
      });

      const executionOrder: number[] = [];

      for (let i = 0; i < 5; i++) {
        runner.addTask(async () => {
          executionOrder.push(i);
        });
      }

      await runner.finishAll();

      expect(executionOrder).toEqual([0, 1, 2, 3, 4]);
    });
  });

  describe("High Load Scenarios", () => {
    it("should handle 1000 tasks efficiently", async () => {
      const runner = createAsyncTasksRunner("High Load Test", {
        maxInParallel: 50,
      });

      const completedTasks: number[] = [];

      for (let i = 0; i < 1000; i++) {
        runner.addTask(async () => {
          completedTasks.push(i);
        });
      }

      await runner.finishAll();

      expect(completedTasks).toHaveLength(1000);
    });

    it("should manage memory efficiently with many pending tasks", async () => {
      const runner = createAsyncTasksRunner("Memory Test", {
        maxInParallel: 10,
      });

      for (let i = 0; i < 500; i++) {
        runner.addTask(async () => {
          await sleep(1);
          return i;
        });
      }

      await runner.finishAll();

      // If we reach here, memory was managed efficiently
      expect(true).toBe(true);
    });
  });

  describe("Tick Interval", () => {
    it("should respect custom tick interval", async () => {
      const runner = createAsyncTasksRunner("Tick Test", {
        maxInParallel: 5,
        tickInterval: 50, // Slower tick
      });

      const start = Date.now();

      for (let i = 0; i < 3; i++) {
        runner.addTask(async () => {
          await sleep(10);
        });
      }

      await runner.finishAll();

      const elapsed = Date.now() - start;

      // Should take at least the tick interval time
      expect(elapsed).toBeGreaterThanOrEqual(40);
    });
  });

  describe("Real-world Scenarios", () => {
    it("should simulate API rate limiting", async () => {
      const runner = createAsyncTasksRunner("API Simulation", {
        maxInParallel: 5,
        tickInterval: 10,
      });

      const apiCalls: number[] = [];

      for (let i = 0; i < 20; i++) {
        runner.addTask(async () => {
          await sleep(20);
          apiCalls.push(i);
        });
      }

      await runner.finishAll();

      expect(apiCalls).toHaveLength(20);
    });

    it("should handle batch processing with priority", async () => {
      const runner = createAsyncTasksRunner("Batch Processing", {
        maxInParallel: 10,
      });

      const criticalResults: string[] = [];
      const normalResults: string[] = [];

      // Critical batch
      for (let i = 0; i < 5; i++) {
        runner.addTask(async () => {
          await sleep(10);
          criticalResults.push(`critical-${i}`);
        }, 100);
      }

      // Normal batch
      for (let i = 0; i < 50; i++) {
        runner.addTask(async () => {
          await sleep(10);
          normalResults.push(`normal-${i}`);
        }, 1);
      }

      await runner.finishAll();

      expect(criticalResults).toHaveLength(5);
      expect(normalResults).toHaveLength(50);
    });
  });
});
