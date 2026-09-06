import { Test, TestingModule } from '@nestjs/testing';
import { ResourceStatus } from '../common/entities/resource-status.enum';
import { GeneralException } from '../common/exceptions/general.exception';
import { Community } from '../communities/entities/community.entity';
import { DebatesService } from '../debates/debates.service';
import { Debate, DebateTurn } from '../debates/entities/debate.entity';
import { DebateErrorCode } from '../debates/exceptions/debate-error-code';
import {
  DEBATE_CHAT_STATE_STORE,
  InMemoryDebateChatStateStore,
} from './debate-chat-state.store';
import { DebateChatConfig } from './debate-chat.config';
import { DebateChatPublisher } from './debate-chat.publisher';
import { DebateChatService } from './debate-chat.service';
import {
  DebateChatStatus,
  DebateEndReason,
  DebatePhase,
  DebateSide,
} from './debate-chat.types';
import { DEBATE_PROCESSING_PIPELINE } from './debate-processing-pipeline';
import { DebateChatErrorCode } from './exceptions/debate-chat-error-code';

describe('DebateChatService', () => {
  let service: DebateChatService;
  let debatesService: { findOneOrThrow: jest.Mock };
  let publisher: { turnFinalized: jest.Mock; debateEnded: jest.Mock };
  let pipeline: { start: jest.Mock };

  const DEBATE_ID = 'debate-uuid';
  const COMMUNITY_ID = 'community-uuid';
  const HOST_ID = 'host-uuid';
  const OPPONENT_ID = 'opponent-uuid';

  const buildDebate = (overrides: Partial<Debate> = {}): Debate =>
    Object.assign(new Debate(), {
      id: DEBATE_ID,
      communityId: COMMUNITY_ID,
      hostId: HOST_ID,
      hostNickname: '메시',
      opponentId: OPPONENT_ID,
      opponentNickname: '호날두',
      currentTurn: DebateTurn.HOST,
      winnerId: null,
      solution: null,
      status: ResourceStatus.NORMAL,
      community: Object.assign(new Community(), {
        id: COMMUNITY_ID,
        // N=0 → OPENING(A,B) → CLOSING(A,B) 4턴
        debateRoundCount: 0,
        status: ResourceStatus.NORMAL,
      }),
      ...overrides,
    });

  const opening = (side: DebateSide) => ({
    speakerId: side === DebateSide.SIDE_A ? HOST_ID : OPPONENT_ID,
    speakerSide: side,
    phase: DebatePhase.OPENING,
    round: 1,
  });

  const send = (
    side: DebateSide,
    content: string,
    clientMessageId?: string,
    phase = DebatePhase.OPENING,
  ) =>
    service.appendDraft(
      DEBATE_ID,
      opening(side).speakerId,
      { ...opening(side), phase, content },
      clientMessageId,
    );

  const finalize = (side: DebateSide, phase = DebatePhase.OPENING) =>
    service.finalizeTurn(DEBATE_ID, opening(side).speakerId, {
      ...opening(side),
      phase,
    });

  const expectCode = async (promise: Promise<unknown>, code: string) => {
    await expect(promise).rejects.toBeInstanceOf(GeneralException);
    await expect(promise).rejects.toMatchObject({ appError: { code } });
  };

  const ALL_TURNS: [DebateSide, DebatePhase][] = [
    [DebateSide.SIDE_A, DebatePhase.OPENING],
    [DebateSide.SIDE_B, DebatePhase.OPENING],
    [DebateSide.SIDE_A, DebatePhase.CLOSING],
    [DebateSide.SIDE_B, DebatePhase.CLOSING],
  ];

  beforeEach(async () => {
    debatesService = {
      findOneOrThrow: jest.fn().mockResolvedValue(buildDebate()),
    };
    publisher = { turnFinalized: jest.fn(), debateEnded: jest.fn() };
    pipeline = { start: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DebateChatService,
        { provide: DebatesService, useValue: debatesService },
        { provide: DebateChatPublisher, useValue: publisher },
        { provide: DEBATE_PROCESSING_PIPELINE, useValue: pipeline },
        // 저장소는 직렬화 계약을 그대로 쓰기 위해 실제 인메모리 구현체를 쓴다.
        {
          provide: DEBATE_CHAT_STATE_STORE,
          useClass: InMemoryDebateChatStateStore,
        },
        {
          provide: DebateChatConfig,
          useValue: {
            limits: {
              maxContentLength: 10,
              maxTotalCharacters: 30,
              maxDurationSeconds: 180,
            },
          },
        },
      ],
    }).compile();

    service = module.get(DebateChatService);
  });

  describe('restore', () => {
    it('첫 접근 시 토론을 읽어 초기 snapshot(OPENING/1/SIDE_A)을 만든다', async () => {
      const snapshot = await service.restore(DEBATE_ID);

      expect(debatesService.findOneOrThrow).toHaveBeenCalledWith(DEBATE_ID);
      expect(snapshot).toMatchObject({
        debateId: DEBATE_ID,
        currentTurn: {
          phase: DebatePhase.OPENING,
          round: 1,
          turnSide: DebateSide.SIDE_A,
          maxDurationSeconds: 180,
          maxTotalCharacters: 30,
        },
        turns: [],
        draftMessages: [],
      });
    });

    it('두 번째 접근은 토론을 다시 읽지 않고 같은 상태를 돌려준다', async () => {
      await send(DebateSide.SIDE_A, 'a');
      const snapshot = await service.restore(DEBATE_ID);

      expect(debatesService.findOneOrThrow).toHaveBeenCalledTimes(1);
      expect(snapshot.draftMessages).toHaveLength(1);
    });

    it('존재하지 않거나 삭제된 토론이면 NOT_FOUND를 그대로 전파한다', async () => {
      debatesService.findOneOrThrow.mockRejectedValue(
        new GeneralException(DebateErrorCode.NOT_FOUND),
      );
      await expectCode(
        service.restore(DEBATE_ID),
        DebateErrorCode.NOT_FOUND.code,
      );
    });

    it('상대 발언자가 없는 토론은 OPPONENT_MISSING', async () => {
      debatesService.findOneOrThrow.mockResolvedValue(
        buildDebate({ opponentId: null, opponentNickname: null }),
      );
      await expectCode(
        service.restore(DEBATE_ID),
        DebateChatErrorCode.OPPONENT_MISSING.code,
      );
    });
  });

  describe('appendDraft', () => {
    it('현재 발언자의 draft를 APPENDED로 저장한다(host = SIDE_A)', async () => {
      const result = await send(DebateSide.SIDE_A, '첫 발언', 'c-1');

      expect(result).toMatchObject({
        status: 'APPENDED',
        message: {
          debateId: DEBATE_ID,
          clientMessageId: 'c-1',
          speakerId: HOST_ID,
          speakerSide: DebateSide.SIDE_A,
          content: '첫 발언',
        },
      });
    });

    it('같은 clientMessageId 재전송은 DUPLICATE + 기존 메시지', async () => {
      const first = await send(DebateSide.SIDE_A, '첫 발언', 'c-1');
      const second = await send(DebateSide.SIDE_A, '다른 내용', 'c-1');

      expect(second.status).toBe('DUPLICATE');
      expect(second.message).toEqual(first.message);
    });

    it('관전자는 NOT_PARTICIPANT', async () => {
      await expectCode(
        service.appendDraft(DEBATE_ID, 'viewer', {
          ...opening(DebateSide.SIDE_A),
          speakerId: 'viewer',
          content: 'x',
        }),
        DebateChatErrorCode.NOT_PARTICIPANT.code,
      );
    });

    it('payload의 speakerId가 토큰 회원과 다르면 SPEAKER_MISMATCH', async () => {
      await expectCode(
        service.appendDraft(DEBATE_ID, HOST_ID, {
          ...opening(DebateSide.SIDE_A),
          speakerId: OPPONENT_ID,
          content: 'x',
        }),
        DebateChatErrorCode.SPEAKER_MISMATCH.code,
      );
    });

    it('차례가 아닌 참가자(opponent = SIDE_B)는 TURN_MISMATCH', async () => {
      await expectCode(
        send(DebateSide.SIDE_B, 'x'),
        DebateChatErrorCode.TURN_MISMATCH.code,
      );
    });

    it('길이 초과는 CONTENT_TOO_LONG', async () => {
      await expectCode(
        send(DebateSide.SIDE_A, 'x'.repeat(11)),
        DebateChatErrorCode.CONTENT_TOO_LONG.code,
      );
    });
  });

  describe('finalizeTurn', () => {
    it('방 전체에 finalized를 발행하고, 마지막 차례가 아니면 ended·파이프라인은 없다', async () => {
      await send(DebateSide.SIDE_A, '하나');
      await send(DebateSide.SIDE_A, '둘');

      const turn = await finalize(DebateSide.SIDE_A);

      expect(turn).toMatchObject({ sequence: 1, content: '하나\n둘' });
      expect(publisher.turnFinalized).toHaveBeenCalledWith(DEBATE_ID, turn);
      expect(publisher.debateEnded).not.toHaveBeenCalled();
      expect(pipeline.start).not.toHaveBeenCalled();
    });

    it('draft 없이 finalize하면 TURN_EMPTY', async () => {
      await expectCode(
        finalize(DebateSide.SIDE_A),
        DebateChatErrorCode.TURN_EMPTY.code,
      );
    });

    it('마지막 차례를 확정하면 ended를 발행하고 파이프라인을 정확히 한 번 시작한다', async () => {
      for (const [side, phase] of ALL_TURNS) {
        await send(side, 'x', undefined, phase);
        await finalize(side, phase);
      }

      expect(publisher.turnFinalized).toHaveBeenCalledTimes(4);
      expect(publisher.debateEnded).toHaveBeenCalledTimes(1);
      expect(publisher.debateEnded).toHaveBeenCalledWith({
        communityId: COMMUNITY_ID,
        debateId: DEBATE_ID,
        status: DebateChatStatus.DEBATE_FINALIZED,
        reason: DebateEndReason.ALL_TURNS_FINALIZED,
      });
      expect(pipeline.start).toHaveBeenCalledTimes(1);
      expect(pipeline.start).toHaveBeenCalledWith(DEBATE_ID);

      // 종료 뒤의 명령은 거부된다.
      await expectCode(
        send(DebateSide.SIDE_A, 'x'),
        DebateChatErrorCode.NOT_IN_PROGRESS.code,
      );
    });

    it('파이프라인이 실패해도 finalize 결과에는 영향이 없다', async () => {
      pipeline.start.mockRejectedValue(new Error('llm down'));
      let last: unknown;
      for (const [side, phase] of ALL_TURNS) {
        await send(side, 'x', undefined, phase);
        last = await finalize(side, phase);
      }
      expect(last).toMatchObject({ sequence: 4 });
    });

    it('동시에 들어온 두 명령은 직렬화되어 하나만 통과한다(같은 차례 두 번 finalize)', async () => {
      await send(DebateSide.SIDE_A, 'x');
      const results = await Promise.allSettled([
        finalize(DebateSide.SIDE_A),
        finalize(DebateSide.SIDE_A),
      ]);

      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
      expect(publisher.turnFinalized).toHaveBeenCalledTimes(1);
    });
  });
});
