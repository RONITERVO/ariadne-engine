export class HttpError extends Error {
  constructor(message: string, public readonly statusCode = 500, public readonly code = 'internal_error') {
    super(message);
    this.name = 'HttpError';
  }
}
