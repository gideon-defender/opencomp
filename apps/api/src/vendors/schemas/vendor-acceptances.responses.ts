import type { ApiResponseOptions } from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../../openapi/common-responses';
import {
  LIST_RISK_ACCEPTANCES_RESPONSES,
  RECORD_RISK_ACCEPTANCE_RESPONSES,
} from '../../risks/schemas/risk-acceptances.responses';

// Vendor risk acceptances share the exact response shape with risk
// acceptances — only the 404 subject differs.

const vendorForbidden: ApiResponseOptions = {
  status: 403,
  description:
    'Forbidden - User does not have permission to access vendor risks',
  type: ApiErrorResponseDto,
};

const vendorNotFound: ApiResponseOptions = {
  status: 404,
  description: 'Vendor not found',
  type: ApiErrorResponseDto,
};

export const LIST_VENDOR_ACCEPTANCES_RESPONSES: Record<
  number,
  ApiResponseOptions
> = {
  ...LIST_RISK_ACCEPTANCES_RESPONSES,
  403: vendorForbidden,
  404: vendorNotFound,
};

export const RECORD_VENDOR_ACCEPTANCE_RESPONSES: Record<
  number,
  ApiResponseOptions
> = {
  ...RECORD_RISK_ACCEPTANCE_RESPONSES,
  403: vendorForbidden,
  404: vendorNotFound,
};
