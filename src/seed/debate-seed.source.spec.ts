import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DebateSeed,
  DebateSeedSource,
  SEED_DEBATE_DATA_PATH,
} from './debate-seed.source';

describe('DebateSeedSource', () => {
  let source: DebateSeedSource;
  let configuredPath: string | undefined;
  let directory: string;

  const validSeed: DebateSeed = {
    communityTopic: '기본소득 도입에 찬성하는가',
    hostEmail: 'user1@example.com',
    opponentEmail: 'user2@example.com',
    messages: [
      { email: 'user1@example.com', turn: 1, body: '찬성합니다' },
      { email: 'user2@example.com', turn: 2, body: '반대합니다' },
    ],
  };

  /** 임시 디렉터리에 시드 파일을 쓰고 환경변수 경로로 지정한다 */
  const givenSeedFile = async (contents: string): Promise<void> => {
    configuredPath = join(directory, 'debate-messages.json');
    await writeFile(configuredPath, contents, 'utf-8');
  };

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'debate-seed-'));
  });

  beforeEach(async () => {
    configuredPath = undefined;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DebateSeedSource,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === SEED_DEBATE_DATA_PATH ? configuredPath : undefined,
            ),
          },
        },
      ],
    }).compile();

    source = module.get(DebateSeedSource);
  });

  it('경로가 설정되지 않으면 빈 배열을 반환한다', async () => {
    await expect(source.load()).resolves.toEqual([]);
  });

  it('경로는 있으나 파일이 없으면 빈 배열을 반환한다', async () => {
    configuredPath = join(directory, 'missing.json');

    await expect(source.load()).resolves.toEqual([]);
  });

  it('상대 경로는 cwd가 아니라 프로젝트 루트 기준으로 푼다', async () => {
    // 루트의 package.json을 가리킨다. "형식이 올바르지 않습니다"까지 갔다는 것은
    // 파일을 실제로 찾아 읽었다는 뜻이다(못 찾았으면 빈 배열로 끝난다).
    configuredPath = 'package.json';

    await expect(source.load()).rejects.toThrow('형식이 올바르지 않습니다');
  });

  it('정상 파일을 파싱해 시드를 반환한다', async () => {
    await givenSeedFile(JSON.stringify([validSeed]));

    await expect(source.load()).resolves.toEqual([validSeed]);
  });

  it('JSON이 깨졌으면 에러를 던지되 본문을 노출하지 않는다', async () => {
    const secret = '외부에 노출되면 안 되는 대화 본문';
    await givenSeedFile(`[{ "body": "${secret}" `);

    // JSON.parse의 SyntaxError는 입력 일부를 메시지에 담으므로, 그대로 새지 않는지 확인한다.
    const error = await source.load().catch((thrown: Error) => thrown);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('JSON 파싱에 실패했습니다');
    expect((error as Error).message).not.toContain(secret);
  });

  it('최상위가 배열이 아니면 에러를 던진다', async () => {
    await givenSeedFile(JSON.stringify(validSeed));

    await expect(source.load()).rejects.toThrow('형식이 올바르지 않습니다');
  });

  it('필수 필드가 빠졌으면 에러를 던진다', async () => {
    await givenSeedFile(
      JSON.stringify([{ ...validSeed, opponentEmail: undefined }]),
    );

    await expect(source.load()).rejects.toThrow('형식이 올바르지 않습니다');
  });

  it('메시지 형식이 어긋나면 에러를 던진다', async () => {
    await givenSeedFile(
      JSON.stringify([
        {
          ...validSeed,
          messages: [{ email: 'user1@example.com', turn: '1', body: '본문' }],
        },
      ]),
    );

    await expect(source.load()).rejects.toThrow('형식이 올바르지 않습니다');
  });
});
