import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CalcRecord } from './entities/calc-record.entity';
import { BatchRecord } from './entities/batch-record.entity';
import { HistoryService } from './history.service';

@Module({
  imports: [TypeOrmModule.forFeature([CalcRecord, BatchRecord])],
  providers: [HistoryService],
  exports: [HistoryService],
})
export class PersistenceModule {}
