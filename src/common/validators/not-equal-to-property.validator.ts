import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'notEqualToProperty', async: false })
export class NotEqualToPropertyConstraint implements ValidatorConstraintInterface {
  // 같은 DTO의 다른 프로퍼티와 값이 다른지 검증한다(예: 양쪽 발언자가 같은 사람이면 안 된다).
  validate(value: unknown, args: ValidationArguments): boolean {
    const [otherProperty] = args.constraints as [string];
    return value !== (args.object as Record<string, unknown>)[otherProperty];
  }

  defaultMessage(args: ValidationArguments): string {
    const [otherProperty] = args.constraints as [string];
    return `${args.property}는 ${otherProperty}와 달라야 합니다.`;
  }
}

export function NotEqualToProperty(
  otherProperty: string,
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'notEqualToProperty',
      target: object.constructor,
      propertyName,
      constraints: [otherProperty],
      options: validationOptions,
      validator: NotEqualToPropertyConstraint,
    });
  };
}
