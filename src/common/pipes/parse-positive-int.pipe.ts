import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  ParseIntPipe,
  PipeTransform,
} from '@nestjs/common';
// 데코레이터가 붙은 생성자 시그니처의 타입은 isolatedModules + emitDecoratorMetadata 조합에서
// 반드시 type-only로 가져와야 한다.
import type { ParseIntPipeOptions } from '@nestjs/common';

/**
 * 정수 파싱 후 하한(1 이상)까지 검증하는 재사용 파이프.
 * `{ optional: true }`로 만들면 값이 없을 때 undefined를 그대로 통과시킨다(하한 검사 대상이 아니다).
 *
 * ParseIntPipe를 상속하지 않고 안에 두는 이유: 상속하면 반환 타입이 `Promise<number>`로 고정돼
 * optional일 때 실제로 나오는 undefined를 타입으로 표현할 수 없다.
 */
@Injectable()
export class ParsePositiveIntPipe implements PipeTransform<
  string | undefined,
  Promise<number | undefined>
> {
  private readonly parseInt: ParseIntPipe;

  constructor(options?: ParseIntPipeOptions) {
    this.parseInt = new ParseIntPipe(options);
  }

  async transform(
    value: string | undefined,
    metadata: ArgumentMetadata,
  ): Promise<number | undefined> {
    const parsed = (await this.parseInt.transform(
      value as string,
      metadata,
    )) as number | undefined;

    if (parsed === undefined) {
      return undefined;
    }
    if (parsed < 1) {
      throw new BadRequestException(
        `${metadata.data ?? 'value'}은(는) 1 이상이어야 합니다.`,
      );
    }
    return parsed;
  }
}
