import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiGoneResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ReservationService } from '../application/reservation.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { ErrorResponse, ReservationResponse } from './dto/responses';

@ApiTags('reservations')
@Controller()
export class ReservationsController {
  constructor(private readonly reservations: ReservationService) {}

  @Post('products/:productId/reservations')
  @ApiOperation({ summary: 'Hold stock for 2 minutes' })
  @ApiCreatedResponse({ type: ReservationResponse, description: 'Reservation is ACTIVE' })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  @ApiNotFoundResponse({ type: ErrorResponse, description: 'PRODUCT_NOT_FOUND' })
  @ApiConflictResponse({ type: ErrorResponse, description: 'INSUFFICIENT_STOCK' })
  async reserve(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: CreateReservationDto,
  ): Promise<ReservationResponse> {
    const reservation = await this.reservations.reserve({
      productId,
      userId: dto.userId,
      quantity: dto.quantity,
    });
    return new ReservationResponse(reservation);
  }

  @Get('reservations/:reservationId')
  @ApiOperation({ summary: 'Get a reservation with its effective status' })
  @ApiOkResponse({ type: ReservationResponse })
  @ApiNotFoundResponse({ type: ErrorResponse, description: 'RESERVATION_NOT_FOUND' })
  async get(
    @Param('reservationId', ParseUUIDPipe) reservationId: string,
  ): Promise<ReservationResponse> {
    return new ReservationResponse(await this.reservations.get(reservationId));
  }

  @Post('reservations/:reservationId/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete the purchase (irreversible)' })
  @ApiOkResponse({ type: ReservationResponse, description: 'Reservation is CONFIRMED' })
  @ApiNotFoundResponse({ type: ErrorResponse, description: 'RESERVATION_NOT_FOUND' })
  @ApiConflictResponse({ type: ErrorResponse, description: 'INVALID_RESERVATION_STATE' })
  @ApiGoneResponse({ type: ErrorResponse, description: 'RESERVATION_EXPIRED' })
  async confirm(
    @Param('reservationId', ParseUUIDPipe) reservationId: string,
  ): Promise<ReservationResponse> {
    return new ReservationResponse(await this.reservations.confirm(reservationId));
  }

  @Post('reservations/:reservationId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel the hold and release its stock' })
  @ApiOkResponse({ type: ReservationResponse, description: 'Reservation is CANCELLED' })
  @ApiNotFoundResponse({ type: ErrorResponse, description: 'RESERVATION_NOT_FOUND' })
  @ApiConflictResponse({ type: ErrorResponse, description: 'INVALID_RESERVATION_STATE' })
  @ApiGoneResponse({ type: ErrorResponse, description: 'RESERVATION_EXPIRED' })
  async cancel(
    @Param('reservationId', ParseUUIDPipe) reservationId: string,
  ): Promise<ReservationResponse> {
    return new ReservationResponse(await this.reservations.cancel(reservationId));
  }
}
