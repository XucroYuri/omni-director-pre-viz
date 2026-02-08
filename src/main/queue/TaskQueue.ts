import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc';
import type { DBTask } from '../../shared/types';
import { taskRepo } from '../db/repos/taskRepo';
import { TaskRunner } from './TaskRunner';

export class TaskQueue {
  private queue: DBTask[] = [];
  private repo = taskRepo;
  private runner = new TaskRunner();
  private isProcessing = false;
  private controllers = new Map<string, AbortController>();

  enqueue(task: DBTask): void {
    this.repo.upsert(task);
    this.queue.push(task);
    void this.processNext();
  }

  dequeue(): DBTask | undefined {
    return this.queue.shift();
  }

  restore(): void {
    const pending = this.repo.getPending();

    for (const task of pending) {
      if (task.status === 'running') {
        const resetTask: DBTask = {
          ...task,
          status: 'queued',
          progress: null,
          error: null,
          updated_at: Date.now(),
        };
        this.queue.push(resetTask);
        this.repo.upsert(resetTask);
      } else {
        this.queue.push(task);
      }
    }

    void this.processNext();
  }

  updateTask(task: DBTask): void {
    const index = this.queue.findIndex((item) => item.id === task.id);
    if (index !== -1) {
      this.queue[index] = task;
    }
    this.repo.upsert(task);
    this.broadcastUpdate(task);
  }

  peek(): DBTask | undefined {
    return this.queue[0];
  }

  size(): number {
    return this.queue.length;
  }

  list(): DBTask[] {
    return [...this.queue];
  }

  cancelTask(taskId: string): void {
    const controller = this.controllers.get(taskId);
    if (controller) {
      controller.abort();
      return;
    }

    const index = this.queue.findIndex((item) => item.id === taskId);
    if (index === -1) return;

    const [task] = this.queue.splice(index, 1);
    const cancelledTask: DBTask = {
      ...task,
      status: 'cancelled',
      error: 'cancelled',
      updated_at: Date.now(),
    };
    this.updateTask(cancelledTask);
  }

  retryTask(taskId: string): void {
    const task = this.repo.get(taskId);
    if (!task) return;
    if (task.status !== 'failed' && task.status !== 'cancelled') return;

    this.controllers.delete(taskId);
    this.queue = this.queue.filter((item) => item.id !== taskId);

    const retriedTask: DBTask = {
      ...task,
      status: 'queued',
      progress: null,
      error: null,
      updated_at: Date.now(),
    };
    this.updateTask(retriedTask);
    this.queue.push(retriedTask);
    void this.processNext();
  }

  async processNext(): Promise<void> {
    if (this.isProcessing) return;
    const next = this.dequeue();
    if (!next) return;

    this.isProcessing = true;
    const runningTask: DBTask = { ...next, status: 'running', updated_at: Date.now() };
    this.updateTask(runningTask);
    const controller = new AbortController();
    this.controllers.set(runningTask.id, controller);

    try {
      await this.runner.execute(runningTask, controller.signal);
      const completedTask: DBTask = {
        ...runningTask,
        status: 'completed',
        error: null,
        updated_at: Date.now(),
      };
      this.updateTask(completedTask);
    } catch (err) {
      if (this.isAbortError(err)) {
        const cancelledTask: DBTask = {
          ...runningTask,
          status: 'cancelled',
          error: 'cancelled',
          updated_at: Date.now(),
        };
        this.updateTask(cancelledTask);
      } else {
        const message = err instanceof Error ? err.message : String(err);
        const failedTask: DBTask = {
          ...runningTask,
          status: 'failed',
          error: message,
          updated_at: Date.now(),
        };
        this.updateTask(failedTask);
      }
    } finally {
      this.isProcessing = false;
      this.controllers.delete(runningTask.id);
      if (this.queue.length > 0) {
        void this.processNext();
      }
    }
  }

  private broadcastUpdate(task: DBTask): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC_CHANNELS.app.task.update, task);
    }
  }

  private isAbortError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    if (err.name === 'AbortError') return true;
    const cause = (err as Error & { cause?: unknown }).cause;
    return cause instanceof Error && cause.name === 'AbortError';
  }
}

export const taskQueue = new TaskQueue();
