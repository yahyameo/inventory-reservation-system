import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateReservationDto {
  /** Identifies the shopper. Authentication is out of scope, so the client supplies it. */
  @ApiProperty({ example: 'alice', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  userId!: string;

  @ApiPropertyOptional({ example: 1, minimum: 1, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity: number = 1;
}
