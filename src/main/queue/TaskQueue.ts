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

  enqueue(task: DBTask): void {
    this.repo.upsert(task);
    this.queue.push(task);
    void this.processNext();
  }

  dequeue(): DBTask | undefined {
    return this.queue.pop();
  }

  restore(): void {
    const pending = this.repo.getPending();

    for (const task of pending) {
      if (task.status === 'running') {
        const resetTask: DBTask = {
          ...task,
          status: 'queued',
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
    return this.queue[this.queue.length - 1];
  }

  size(): number {
    return this.queue.length;
  }

  list(): DBTask[] {
    return [...this.queue];
  }

  async processNext(): Promise<void> {
    if (this.isProcessing) return;
    const next = this.dequeue();
    if (!next) return;

    this.isProcessing = true;
    const runningTask: DBTask = { ...next, status: 'running', updated_at: Date.now() };
    this.updateTask(runningTask);

    try {
      await this.runner.execute(runningTask);
      const completedTask: DBTask = {
        ...runningTask,
        status: 'completed',
        error: null,
        updated_at: Date.now(),
      };
      this.updateTask(completedTask);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const failedTask: DBTask = {
        ...runningTask,
        status: 'failed',
        error: message,
        updated_at: Date.now(),
      };
      this.updateTask(failedTask);
    } finally {
      this.isProcessing = false;
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
}

export const taskQueue = new TaskQueue();
