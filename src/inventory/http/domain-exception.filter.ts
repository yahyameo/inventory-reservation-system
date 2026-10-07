import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { DomainError, DomainErrorCode } from '../domain/errors';

/**
 * Maps business-rule rejections to HTTP status codes. The Record type makes
 * the compiler fail if a new DomainErrorCode is added without a mapping.
 */
const STATUS_BY_CODE: Record<DomainErrorCode, HttpStatus> = {
  INVALID_QUANTITY: HttpStatus.BAD_REQUEST,
  PRODUCT_NOT_FOUND: HttpStatus.NOT_FOUND,
  RESERVATION_NOT_FOUND: HttpStatus.NOT_FOUND,
  INSUFFICIENT_STOCK: HttpStatus.CONFLICT,
  INVALID_RESERVATION_STATE: HttpStatus.CONFLICT,
  RESERVATION_EXPIRED: HttpStatus.GONE,
};

@Catch(DomainError)
export class DomainExceptionFilter implements ExceptionFilter<DomainError> {
  catch(error: DomainError, host: ArgumentsHost): void {
    const status = STATUS_BY_CODE[error.code];
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(status)
      .json({ statusCode: status, error: error.code, message: error.message });
  }
}
