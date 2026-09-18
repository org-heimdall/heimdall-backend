import { IsNotEmpty, IsString } from 'class-validator';

/**
 * 명령 봉투의 공통 필드. 어댑터가 봉투 전체를 핸들러에 넘기므로 봉투째 검증한다.
 * clientMessageId는 게이트웨이마다 선택/필수가 갈리는데 class-validator 메타데이터는 부모 것이
 * 그대로 상속돼 자식이 @IsOptional()을 되돌릴 수 없으므로, 각 도메인 DTO가 직접 선언한다.
 */
export class WsCommandDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  type: string;
}
