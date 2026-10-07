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
import { ReservationService } from '../application/reservation.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { ReservationResponse } from './dto/responses';

@Controller()
export class ReservationsController {
  constructor(private readonly reservations: ReservationService) {}

  @Post('products/:productId/reservations')
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
  async get(
    @Param('reservationId', ParseUUIDPipe) reservationId: string,
  ): Promise<ReservationResponse> {
    return new ReservationResponse(await this.reservations.get(reservationId));
  }

  @Post('reservations/:reservationId/confirm')
  @HttpCode(HttpStatus.OK)
  async confirm(
    @Param('reservationId', ParseUUIDPipe) reservationId: string,
  ): Promise<ReservationResponse> {
    return new ReservationResponse(await this.reservations.confirm(reservationId));
  }

  @Post('reservations/:reservationId/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Param('reservationId', ParseUUIDPipe) reservationId: string,
  ): Promise<ReservationResponse> {
    return new ReservationResponse(await this.reservations.cancel(reservationId));
  }
}
