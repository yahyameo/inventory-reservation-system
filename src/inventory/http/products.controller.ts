import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ProductService } from '../application/product.service';
import { CreateProductDto } from './dto/create-product.dto';
import { ErrorResponse, ProductResponse } from './dto/responses';

@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductService) {}

  @Post()
  @ApiOperation({ summary: 'Create a product with a fixed amount of stock' })
  @ApiCreatedResponse({ type: ProductResponse })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  async create(@Body() dto: CreateProductDto): Promise<ProductResponse> {
    return new ProductResponse(await this.products.create(dto));
  }

  @Get(':productId')
  @ApiOperation({ summary: 'Get a product with live availability (lapsed holds released first)' })
  @ApiOkResponse({ type: ProductResponse })
  @ApiNotFoundResponse({ type: ErrorResponse, description: 'PRODUCT_NOT_FOUND' })
  async get(@Param('productId', ParseUUIDPipe) productId: string): Promise<ProductResponse> {
    return new ProductResponse(await this.products.get(productId));
  }
}
