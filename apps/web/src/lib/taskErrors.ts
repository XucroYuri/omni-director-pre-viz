export type TaskErrorCode =
  | 'TASK_PAYLOAD_MISSING'
  | 'TASK_PAYLOAD_INVALID'
  | 'TASK_PAYLOAD_UNSUPPORTED'
  | 'TASK_PRECONDITION_FAILED'
  | 'TASK_ENTITY_NOT_FOUND'
  | 'TASK_EXECUTION_FAILED';

export class TaskWorkerError extends Error {
  readonly code: TaskErrorCode;
  readonly context?: Record<string, unknown>;

  constructor(code: TaskErrorCode, message: string, context?: Record<string, unknown>) {
    super(message);
    this.name = 'TaskWorkerError';
    this.code = code;
    this.context = context;
  }
}

export function isTaskWorkerError(error: unknown): error is TaskWorkerError {
  return error instanceof TaskWorkerError;
}

export function toTaskWorkerError(
  error: unknown,
  fallbackMessage: string,
  context?: Record<string, unknown>,
): TaskWorkerError {
  if (isTaskWorkerError(error)) return error;
  const message = error instanceof Error ? error.message : fallbackMessage;
  return new TaskWorkerError('TASK_EXECUTION_FAILED', message, context);
}

const RETRYABLE_CODES = new Set<TaskErrorCode>(['TASK_EXECUTION_FAILED']);

export function isRetryableTaskErrorCode(code: TaskErrorCode): boolean {
  return RETRYABLE_CODES.has(code);
}
