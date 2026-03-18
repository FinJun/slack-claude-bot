export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class SessionNotFoundError extends AppError {
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`, 'SESSION_NOT_FOUND', 404);
    this.name = 'SessionNotFoundError';
  }
}

export class SessionLimitExceededError extends AppError {
  constructor(userId: string, limit: number) {
    super(
      `User ${userId} has reached the session limit of ${limit}`,
      'SESSION_LIMIT_EXCEEDED',
      429,
    );
    this.name = 'SessionLimitExceededError';
  }
}

export class BudgetExceededError extends AppError {
  constructor(sessionId: string, budgetUsd: number) {
    super(
      `Session ${sessionId} has exceeded the budget of $${budgetUsd}`,
      'BUDGET_EXCEEDED',
      402,
    );
    this.name = 'BudgetExceededError';
  }
}

export class SecurityPolicyError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'SECURITY_POLICY_VIOLATION', 403, details);
    this.name = 'SecurityPolicyError';
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfterMs?: number) {
    super('Rate limit exceeded', 'RATE_LIMIT_EXCEEDED', 429, { retryAfterMs });
    this.name = 'RateLimitError';
  }
}

export class SlackApiError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'SLACK_API_ERROR', 502, details);
    this.name = 'SlackApiError';
  }
}

export class ClaudeApiError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'CLAUDE_API_ERROR', 502, details);
    this.name = 'ClaudeApiError';
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
