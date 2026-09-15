import { MemberCommunity } from '../../member-communities/entities/member-community.entity';
import { Member } from '../../members/entities/member.entity';
import { DebatePhase, DebateSide } from '../debate-turn';
import { DebateStatus } from '../entities/debate-status.enum';
import { Debate } from '../entities/debate.entity';
import { DebateTurnWithVotesDto } from './debate-turn.dto';
import {
  DebateDetailDto,
  DebateDto,
  DebateSpeakerDto,
  NO_PROGRESS,
} from './debate.dto';

describe('Debate DTO 매퍼', () => {
  const HOST_ID = 'host-uuid';
  const OPPONENT_ID = 'opponent-uuid';
  const CREATED_AT = new Date('2026-09-07T11:59:00.000Z');
  const STARTED_AT = new Date('2026-09-07T12:00:00.000Z');
  const EXPIRES_AT = new Date('2026-09-07T12:12:00.000Z');

  const buildDebate = (overrides: Partial<Debate> = {}): Debate =>
    Object.assign(new Debate(), {
      id: 'debate-uuid',
      communityId: 'community-uuid',
      topic: 'AI 규제, 필요한가?',
      // N=1 → OPENING(A,B) → REBUTTAL_QUESTION 1라운드(A,B) → CLOSING(A,B)
      rebuttalQuestionRounds: 1,
      hostId: HOST_ID,
      opponentId: OPPONENT_ID,
      debateStatus: DebateStatus.IN_PROGRESS,
      startedAt: STARTED_AT,
      endedAt: null,
      expiresAt: EXPIRES_AT,
      winnerId: null,
      createdAt: CREATED_AT,
      ...overrides,
    });

  describe('DebateDto', () => {
    it('계약 Debate의 모든 필드를 채우고 host/opponent를 sideA/sideB로 바꾼다', () => {
      expect(DebateDto.from(buildDebate(), NO_PROGRESS)).toEqual({
        id: 'debate-uuid',
        communityId: 'community-uuid',
        topic: 'AI 규제, 필요한가?',
        sideASpeakerId: HOST_ID,
        sideBSpeakerId: OPPONENT_ID,
        rebuttalQuestionRounds: 1,
        status: DebateStatus.IN_PROGRESS,
        currentPhase: DebatePhase.OPENING,
        currentRound: 1,
        currentTurnSide: DebateSide.SIDE_A,
        currentTurnStartedAt: STARTED_AT.toISOString(),
        createdAt: CREATED_AT.toISOString(),
        startedAt: STARTED_AT.toISOString(),
        endedAt: null,
        // 판정 파이프라인 구현 전까지 항상 null이다.
        judgingStartedAt: null,
        expiresAt: EXPIRES_AT.toISOString(),
      });
    });

    it('확정 턴 수와 마지막 턴 시각에서 현재 차례를 파생한다', () => {
      const lastTurnAt = new Date('2026-09-07T12:06:00.000Z');

      expect(
        DebateDto.from(buildDebate(), {
          finalizedTurnCount: 2,
          lastTurnCreatedAt: lastTurnAt,
        }),
      ).toMatchObject({
        currentPhase: DebatePhase.REBUTTAL_QUESTION,
        currentRound: 1,
        currentTurnSide: DebateSide.SIDE_A,
        currentTurnStartedAt: lastTurnAt.toISOString(),
      });
    });

    it('아직 시작하지 않은 토론(status 없음)은 READY이고 현재 차례가 없다', () => {
      const dto = DebateDto.from(
        buildDebate({ debateStatus: null, startedAt: null, expiresAt: null }),
        NO_PROGRESS,
      );

      expect(dto).toMatchObject({
        status: DebateStatus.READY,
        currentPhase: null,
        currentRound: null,
        currentTurnSide: null,
        currentTurnStartedAt: null,
        startedAt: null,
        expiresAt: null,
      });
    });

    it('상대가 아직 없는 토론의 sideBSpeakerId는 null이다', () => {
      expect(
        DebateDto.from(buildDebate({ opponentId: null }), NO_PROGRESS),
      ).toMatchObject({ sideBSpeakerId: null });
    });
  });

  describe('DebateSpeakerDto', () => {
    const member = Object.assign(new Member(), {
      id: HOST_ID,
      nickname: '메시',
      profileImageUrl: 'https://cdn.example.com/1.png',
      rating: 12.5,
      socialCredit: 100,
    });

    it('회원의 프로필·영구 점수와 커뮤니티 기조 발언을 합친다', () => {
      const keynote = Object.assign(new MemberCommunity(), {
        memberId: HOST_ID,
        opinion: 'AI 규제는 필요하다',
        reasons: ['안전', '신뢰'],
      });

      expect(DebateSpeakerDto.from(member, keynote)).toEqual({
        id: HOST_ID,
        displayName: '메시',
        profileImageUrl: 'https://cdn.example.com/1.png',
        score: 12.5,
        claim: 'AI 규제는 필요하다',
        reasons: ['안전', '신뢰'],
      });
    });

    it('기조 발언을 쓰지 않은 발언자는 빈 주장·빈 근거로 채운다', () => {
      expect(DebateSpeakerDto.from(member, null)).toMatchObject({
        claim: '',
        reasons: [],
      });
    });
  });

  describe('DebateDetailDto', () => {
    const speaker = (id: string): DebateSpeakerDto =>
      Object.assign(new DebateSpeakerDto(), {
        id,
        displayName: id,
        profileImageUrl: null,
        score: 0,
        claim: '',
        reasons: [],
      });

    const speakers = {
      [DebateSide.SIDE_A]: speaker(HOST_ID),
      [DebateSide.SIDE_B]: speaker(OPPONENT_ID),
    };

    const turns: DebateTurnWithVotesDto[] = [
      Object.assign(new DebateTurnWithVotesDto(), { likeCount: 2 }),
    ];

    it('Debate의 모든 필드에 발언자·턴·viewerSide를 더한다', () => {
      const detail = DebateDetailDto.fromDetail(buildDebate(), NO_PROGRESS, {
        speakers,
        viewerId: OPPONENT_ID,
        turns,
      });

      expect(detail).toMatchObject({
        id: 'debate-uuid',
        currentPhase: DebatePhase.OPENING,
        sideASpeaker: speakers[DebateSide.SIDE_A],
        sideBSpeaker: speakers[DebateSide.SIDE_B],
        viewerSide: DebateSide.SIDE_B,
        turns,
      });
    });

    it('발언자가 아닌 회원(관전자)의 viewerSide는 null이다', () => {
      const detail = DebateDetailDto.fromDetail(buildDebate(), NO_PROGRESS, {
        speakers,
        viewerId: 'watcher-uuid',
        turns,
      });

      expect(detail.viewerSide).toBeNull();
    });
  });

  describe('DebateTurnWithVotesDto', () => {
    it('확정 턴에 좋아요·싫어요 수를 붙인다', () => {
      const turn = {
        id: 'message-1',
        debateId: 'debate-uuid',
        speakerId: HOST_ID,
        speakerSide: DebateSide.SIDE_A,
        phase: DebatePhase.OPENING,
        round: 1,
        content: '찬성합니다',
        createdAt: STARTED_AT.toISOString(),
        sequence: 1,
      };

      expect(
        DebateTurnWithVotesDto.from(turn, { likeCount: 3, dislikeCount: 1 }),
      ).toEqual({ ...turn, likeCount: 3, dislikeCount: 1 });
    });
  });
});
