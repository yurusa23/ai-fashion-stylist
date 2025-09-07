/**
 * Base class for all application-specific errors.
 */
export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/**
 * Represents an error that occurred during an API call (e.g., network issues, server errors).
 */
export class ApiError extends AppError {
  constructor(message = "API 요청 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.") {
    super(message);
  }
}

/**
 * Represents an error where the request was blocked by safety policies.
 */
export class SafetyError extends AppError {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Represents an error due to invalid user input.
 */
export class ValidationError extends AppError {
  constructor(message: string) {
    super(message);
  }
}
