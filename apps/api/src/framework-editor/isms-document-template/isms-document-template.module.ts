import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { IsmsDocumentTemplateService } from './isms-document-template.service';

@Module({
  imports: [AuthModule],
  controllers: [],
  providers: [IsmsDocumentTemplateService],
  exports: [IsmsDocumentTemplateService],
})
export class IsmsDocumentTemplateModule {}
