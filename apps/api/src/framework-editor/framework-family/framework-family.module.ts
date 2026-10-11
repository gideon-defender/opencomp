import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { FrameworkFamilyService } from './framework-family.service';

@Module({
  imports: [AuthModule],
  controllers: [],
  providers: [FrameworkFamilyService],
  exports: [FrameworkFamilyService],
})
export class FrameworkFamilyModule {}
