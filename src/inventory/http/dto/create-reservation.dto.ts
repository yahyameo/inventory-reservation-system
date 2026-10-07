import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateReservationDto {
  /** Identifies the shopper. Authentication is out of scope, so the client supplies it. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  userId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity: number = 1;
}
