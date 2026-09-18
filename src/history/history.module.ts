import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CalculationRecord } from './calculation-record.entity';
import { HistoryService } from './history.service';

@Module({
  imports: [TypeOrmModule.forFeature([CalculationRecord])],
  providers: [HistoryService],
  exports: [HistoryService, TypeOrmModule],
})
export class HistoryModule {}
