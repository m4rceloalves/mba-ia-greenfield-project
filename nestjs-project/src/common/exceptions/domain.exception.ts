export abstract class DomainException extends Error {
  constructor(
    public readonly errorCode: string,
    public readonly httpStatus: number,
    message: string,
    public readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class EmailAlreadyExistsException extends DomainException {
  constructor() {
    super('EMAIL_ALREADY_EXISTS', 409, 'Email is already registered');
  }
}

export class InvalidCredentialsException extends DomainException {
  constructor() {
    super('INVALID_CREDENTIALS', 401, 'Invalid email or password');
  }
}

export class EmailNotConfirmedException extends DomainException {
  constructor() {
    super('EMAIL_NOT_CONFIRMED', 403, 'Email address has not been confirmed');
  }
}

export class InvalidTokenException extends DomainException {
  constructor() {
    super('INVALID_TOKEN', 401, 'Token is invalid');
  }
}

export class TokenExpiredException extends DomainException {
  constructor() {
    super('TOKEN_EXPIRED', 401, 'Token has expired');
  }
}

export class TokenReuseDetectedException extends DomainException {
  constructor() {
    super(
      'TOKEN_REUSE_DETECTED',
      401,
      'Token reuse detected — all sessions revoked',
    );
  }
}

export class VideoNotFoundException extends DomainException {
  constructor() {
    super('VIDEO_NOT_FOUND', 404, 'Video was not found');
  }
}

export class VideoForbiddenException extends DomainException {
  constructor() {
    super('VIDEO_FORBIDDEN', 403, 'You cannot access this video resource');
  }
}

export class VideoInvalidUploadStateException extends DomainException {
  constructor() {
    super(
      'VIDEO_INVALID_UPLOAD_STATE',
      409,
      'Video upload is not in a valid state for this operation',
    );
  }
}

export class VideoUploadTooLargeException extends DomainException {
  constructor() {
    super('VIDEO_UPLOAD_TOO_LARGE', 413, 'Video upload exceeds the size limit');
  }
}

export class VideoUnsupportedTypeException extends DomainException {
  constructor() {
    super('VIDEO_UNSUPPORTED_TYPE', 415, 'Video MIME type is not supported');
  }
}

export class VideoInvalidPartsException extends DomainException {
  constructor() {
    super('VIDEO_INVALID_PARTS', 400, 'Video upload parts are invalid');
  }
}

export class VideoStorageFailedException extends DomainException {
  constructor() {
    super('VIDEO_STORAGE_FAILED', 502, 'Video storage operation failed');
  }
}

export class VideoQueueFailedException extends DomainException {
  constructor() {
    super(
      'VIDEO_QUEUE_FAILED',
      502,
      'Video processing job could not be queued',
    );
  }
}

export class VideoRangeNotSatisfiableException extends DomainException {
  constructor(size: number) {
    super(
      'VIDEO_RANGE_NOT_SATISFIABLE',
      416,
      'Video byte range is not satisfiable',
      { 'Content-Range': `bytes */${size}` },
    );
  }
}
