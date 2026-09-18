import { Module } from '@nestjs/common';
import { HistoryModule } from '../history/history.module';
import { CalculationController } from './calculation.controller';
import { CalculationService } from './calculation.service';

@Module({
  imports: [HistoryModule],
  controllers: [CalculationController],
  providers: [CalculationService],
})
export class CalculationModule {}
