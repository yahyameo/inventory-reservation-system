import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ProductService } from '../application/product.service';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductResponse } from './dto/responses';

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductService) {}

  @Post()
  async create(@Body() dto: CreateProductDto): Promise<ProductResponse> {
    return new ProductResponse(await this.products.create(dto));
  }

  @Get(':productId')
  async get(@Param('productId', ParseUUIDPipe) productId: string): Promise<ProductResponse> {
    return new ProductResponse(await this.products.get(productId));
  }
}
