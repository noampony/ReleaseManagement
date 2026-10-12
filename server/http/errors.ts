import type { ErrorRequestHandler } from 'express';
import { RecordNotFoundError, VersionConflictError } from '../db/index.js';
import { ValidationError } from './validation.js';

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

export const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
  if (error instanceof ValidationError) {
    response.status(400).json({ error: { code: 'validation_error', message: error.message, details: error.issues } });
    return;
  }
  if (error instanceof VersionConflictError) {
    response.status(409).json({
      error: { code: 'version_conflict', message: error.message, details: {
        current: error.current,
        changedFields: error.changedFields,
      } },
    });
    return;
  }
  if (error instanceof RecordNotFoundError) {
    response.status(404).json({ error: { code: 'not_found', message: error.message } });
    return;
  }
  if (error instanceof HttpError) {
    response.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }
  if (isBodyParserError(error)) {
    response.status(error.status).json({ error: { code: error.type, message: 'Invalid JSON request body' } });
    return;
  }
  response.status(500).json({ error: { code: 'internal_error', message: 'An unexpected error occurred' } });
};

function isBodyParserError(error: unknown): error is { status: number; type: string } {
  if (typeof error !== 'object' || error === null || !('type' in error) || !('status' in error)) return false;
  const candidate = error as { status: unknown; type: unknown };
  return typeof candidate.status === 'number' && typeof candidate.type === 'string'
    && ['entity.parse.failed', 'entity.too.large'].includes(candidate.type);
}
