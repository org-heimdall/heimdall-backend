import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// 시드 파일 경로를 담는 환경변수 이름. 미설정이면 대화 시딩만 건너뛴다.
export const SEED_DEBATE_DATA_PATH = 'SEED_DEBATE_DATA_PATH';

// 상대 경로의 기준점. 실행 위치(cwd)에 따라 파일을 못 찾는 일이 없도록 프로젝트 루트로 고정한다.
// 이 파일은 빌드 전(src/seed)·후(dist/seed) 모두 루트에서 두 단계 아래에 있다.
const PROJECT_ROOT = join(__dirname, '..', '..');

export interface DebateSeedMessage {
  // 발화자 식별용 자연키. seed.service의 MEMBER_SEEDS에 있는 이메일이어야 한다.
  email: string;
  turn: number;
  body: string;
}

export interface DebateSeed {
  // 커뮤니티 식별용 자연키. seed.service의 커뮤니티 시드 topic과 일치해야 한다.
  communityTopic: string;
  hostEmail: string;
  opponentEmail: string;
  messages: DebateSeedMessage[];
}

@Injectable()
export class DebateSeedSource {
  private readonly logger = new Logger(DebateSeedSource.name);

  constructor(private readonly configService: ConfigService) {}

  // 대화 시드는 비공개 데이터라 저장소 밖 파일에서 읽는다(경로만 환경변수로 주입).
  // 경로 미설정·파일 부재는 정상 상황이므로(데이터를 받지 못한 팀원도 부팅돼야 한다)
  // 빈 배열을 반환해 대화 시딩만 건너뛴다. 반면 파일이 있는데 깨진 경우는 조용히 넘기지 않는다.
  async load(): Promise<DebateSeed[]> {
    const configured = this.configService.get<string>(SEED_DEBATE_DATA_PATH);
    if (!configured) {
      return [];
    }

    // 절대 경로면 그대로, 상대 경로면 프로젝트 루트 기준으로 푼다.
    // 이후 로그·에러에는 항상 이 절대 경로를 실어 어느 파일을 봤는지 바로 알 수 있게 한다.
    const path = resolve(PROJECT_ROOT, configured);

    let raw: string;
    try {
      raw = await readFile(path, 'utf-8');
    } catch {
      this.logger.warn(`대화 시드 파일이 없어 건너뜁니다: ${path}`);
      return [];
    }

    // JSON.parse가 던지는 SyntaxError의 메시지에는 입력 일부가 실린다.
    // 시드 본문은 비공개 데이터이므로 원본 에러를 버리고 경로만 남겨 다시 던진다.
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`대화 시드 JSON 파싱에 실패했습니다: ${path}`);
    }

    if (!Array.isArray(parsed) || !parsed.every(isDebateSeed)) {
      throw new Error(`대화 시드 형식이 올바르지 않습니다: ${path}`);
    }

    this.logger.log(`대화 시드 ${parsed.length}건을 읽었습니다.`);
    return parsed;
  }
}

// 저장소 밖 파일이라 컴파일 타임 타입 보장이 없다. 최소 형태만 런타임에 검증한다.
// 검증 실패 시에도 본문을 노출하지 않기 위해 값이 아닌 형태만 판정한다.
function isDebateSeed(value: unknown): value is DebateSeed {
  const seed = value as DebateSeed | undefined;
  return (
    typeof seed?.communityTopic === 'string' &&
    typeof seed?.hostEmail === 'string' &&
    typeof seed?.opponentEmail === 'string' &&
    Array.isArray(seed?.messages) &&
    seed.messages.every(isDebateSeedMessage)
  );
}

function isDebateSeedMessage(value: unknown): value is DebateSeedMessage {
  const message = value as DebateSeedMessage | undefined;
  return (
    typeof message?.email === 'string' &&
    Number.isInteger(message?.turn) &&
    typeof message?.body === 'string'
  );
}
