import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  ParseIntPipe,
} from '@nestjs/common';

// 정수 파싱 후 하한(1 이상)까지 검증하는 재사용 파이프
@Injectable()
export class ParsePositiveIntPipe extends ParseIntPipe {
  async transform(value: string, metadata: ArgumentMetadata): Promise<number> {
    const parsed = await super.transform(value, metadata);
    if (parsed < 1) {
      throw new BadRequestException(
        `${metadata.data ?? 'value'}은(는) 1 이상이어야 합니다.`,
      );
    }
    return parsed;
  }
}
