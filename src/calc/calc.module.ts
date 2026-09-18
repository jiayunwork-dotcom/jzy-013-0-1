import { Module } from '@nestjs/common';
import { CalcController } from './calc.controller';
import { CalcService } from './calc.service';
import { CalcConfigService } from './calc-config.service';
import { PersistenceModule } from '../persistence/persistence.module';

@Module({
  imports: [PersistenceModule],
  controllers: [CalcController],
  providers: [CalcService, CalcConfigService],
})
export class CalcModule {}
