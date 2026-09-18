import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'maxByteLength', async: false })
export class MaxByteLengthConstraint implements ValidatorConstraintInterface {
  // 문자 수가 아닌 실제 UTF-8 인코딩 바이트 길이를 기준으로 상한을 검증
  validate(value: unknown, args: ValidationArguments): boolean {
    if (typeof value !== 'string') {
      return false;
    }
    const [max] = args.constraints as [number];
    return Buffer.byteLength(value, 'utf8') <= max;
  }

  defaultMessage(args: ValidationArguments): string {
    const [max] = args.constraints as [number];
    return `${args.property}의 길이는 UTF-8 기준 최대 ${max}바이트여야 합니다.`;
  }
}

// 실제 UTF-8 바이트 길이가 max 이하인지 검증하는 데코레이터
export function MaxByteLength(
  max: number,
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'maxByteLength',
      target: object.constructor,
      propertyName,
      constraints: [max],
      options: validationOptions,
      validator: MaxByteLengthConstraint,
    });
  };
}
