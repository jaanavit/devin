export class PlatformError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class UnauthenticatedError extends PlatformError {
  constructor(message = "Authentication required") {
    super(message, 401, "unauthenticated");
  }
}

export class AccessDeniedError extends PlatformError {
  constructor(message = "You do not have access to this resource") {
    super(message, 403, "forbidden");
  }
}

export class ValidationError extends PlatformError {
  constructor(message: string, code = "invalid_request") {
    super(message, 400, code);
  }
}

export class NotFoundError extends PlatformError {
  constructor(message = "Not found") {
    super(message, 404, "not_found");
  }
}

export class ConflictError extends PlatformError {
  constructor(message: string, code = "conflict") {
    super(message, 409, code);
  }
}

export type ApprovalErrorCode = "SELF_APPROVAL" | "NOT_PENDING" | "MISSING_ROLE" | "REASON_REQUIRED";

export class ApprovalError extends PlatformError {
  constructor(
    readonly reason: ApprovalErrorCode,
    message: string,
  ) {
    super(message, reason === "MISSING_ROLE" || reason === "SELF_APPROVAL" ? 403 : reason === "REASON_REQUIRED" ? 400 : 409, reason.toLowerCase());
  }
}
