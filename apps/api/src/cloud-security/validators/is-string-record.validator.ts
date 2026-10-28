import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * Validates a plain JSON object whose keys are strings and whose values are
 * all strings — i.e. a string map (`Record<string, string>`). Arrays, null,
 * and non-string values are rejected, matching the OpenAPI
 * `additionalProperties: { type: 'string' }` contract.
 */
@ValidatorConstraint({ name: 'isStringRecord', async: false })
class IsStringRecordConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return false;
    }
    return Object.values(value).every((v) => typeof v === 'string');
  }

  defaultMessage(): string {
    return 'value must be an object mapping string keys to string values';
  }
}

export function IsStringRecord(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsStringRecordConstraint,
    });
  };
}
