import { DebateSide } from '../debates/debate-turn';
import {
  findResidualSideTokens,
  JUDGMENT_TEXT_FALLBACK,
  JudgmentTexts,
  renderJudgmentTexts,
  renderSideTokens,
  scrubResidualSideTokens,
  SideNames,
  toParticipantReference,
} from './judgment-text';

describe('judgment-text', () => {
  const NAMES: SideNames = {
    [DebateSide.SIDE_A]: '메시',
    [DebateSide.SIDE_B]: '호날두',
  };

  describe('toParticipantReference', () => {
    it.each([
      [undefined, '메시님'],
      ['는', '메시님은'],
      ['은', '메시님은'],
      ['가', '메시님이'],
      ['를', '메시님을'],
      ['와', '메시님과'],
      ['로', '메시님으로'],
      ['으로', '메시님으로'],
    ])('조사 %s → %s', (josa, expected) => {
      expect(toParticipantReference('메시', josa)).toBe(expected);
    });
  });

  describe('renderSideTokens', () => {
    it.each([
      ['SIDE_A가 앞섰다.', '메시님이 앞섰다.'],
      ['SIDE_A는 근거가 약했다.', '메시님은 근거가 약했다.'],
      ['SIDE B의 반론', '호날두님의 반론'],
      ['side-a와 Side_B', '메시님과 호날두님'],
      ['SIDE_B를 설득하지 못했다', '호날두님을 설득하지 못했다'],
      ['SIDE_A로서는', '메시님로서는'],
      ['A측은 근거가 약했다.', '메시님은 근거가 약했다.'],
      ['B 측의 질문', '호날두님의 질문'],
      ['A편과 B편', '메시님과 호날두님'],
      ['측면 A의 주장', '메시님의 주장'],
      ['SIDE_A이번에', '메시님이번에'],
    ])('%s → %s', (input, expected) => {
      expect(renderSideTokens(input, NAMES)).toBe(expected);
    });

    it.each([
      ['inside a box'],
      ['SIDE_AB 코드'],
      ['A측면에서 보면'],
      ['PLANA측'],
      ['a측'],
    ])('side 표기가 아닌 "%s"는 그대로 둔다', (input) => {
      expect(renderSideTokens(input, NAMES)).toBe(input);
    });

    it('바꿔 넣은 닉네임은 다시 바꾸지 않는다', () => {
      const names: SideNames = {
        [DebateSide.SIDE_A]: 'SIDE_B',
        [DebateSide.SIDE_B]: '호날두',
      };

      expect(renderSideTokens('SIDE_A 승', names)).toBe('SIDE_B님 승');
    });
  });

  describe('findResidualSideTokens', () => {
    it('변환 규칙이 놓친 표기를 찾는다', () => {
      expect(findResidualSideTokens('SIDE__A와 SIDE_Bx', NAMES)).toEqual([
        'SIDE__A',
        'SIDE_B',
      ]);
    });

    it('흔적이 없으면 빈 배열이다', () => {
      expect(findResidualSideTokens('메시님이 inside a 이겼다', NAMES)).toEqual(
        [],
      );
    });

    it('참여자 닉네임 자체는 흔적으로 보지 않는다', () => {
      const names: SideNames = {
        [DebateSide.SIDE_A]: 'SIDE_A',
        [DebateSide.SIDE_B]: '호날두',
      };

      expect(findResidualSideTokens('SIDE_A님이 이겼다', names)).toEqual([]);
    });
  });

  describe('scrubResidualSideTokens', () => {
    it('넓은 패턴으로 남은 흔적을 호칭으로 바꾸고 조사를 맞춘다', () => {
      const scrubbed = scrubResidualSideTokens('SIDE__A와 SIDE_Bx', NAMES);

      expect(scrubbed).toBe('메시님과 호날두님x');
      expect(findResidualSideTokens(scrubbed, NAMES)).toEqual([]);
    });
  });

  describe('renderJudgmentTexts', () => {
    const raw = (overrides: Partial<JudgmentTexts> = {}): JudgmentTexts => ({
      overallReason: 'SIDE_A가 앞섰다.',
      sideAFeedback: '',
      sideBFeedback: 'SIDE_B는 잘했다.',
      ...overrides,
    });

    it('규칙대로 바뀌면 위반이 없다', () => {
      const { texts, violations } = renderJudgmentTexts(raw(), NAMES);

      expect(texts).toEqual({
        overallReason: '메시님이 앞섰다.',
        sideAFeedback: '',
        sideBFeedback: '호날두님은 잘했다.',
      });
      expect(violations).toEqual([]);
    });

    it('규칙이 놓친 토큰은 위반으로 알리고 강제로 치환한다', () => {
      const { texts, violations } = renderJudgmentTexts(
        raw({ overallReason: 'SIDE__A와 SIDE_Bx를 비교하면' }),
        NAMES,
      );

      expect(texts.overallReason).toBe('메시님과 호날두님x를 비교하면');
      expect(violations).toEqual([
        { field: 'overallReason', tokens: ['SIDE__A', 'SIDE_B'] },
      ]);
    });

    it('강제 치환 뒤에도 흔적이 남으면 대체 문장을 쓴다', () => {
      // 닉네임을 지우고 보면 "SIDE A"가 되는 문장이라 치환으로는 지울 수 없다.
      const { texts } = renderJudgmentTexts(
        raw({ sideAFeedback: 'SIDE메시A' }),
        NAMES,
      );

      expect(texts.sideAFeedback).toBe(JUDGMENT_TEXT_FALLBACK);
      expect(texts.overallReason).toBe('메시님이 앞섰다.');
    });
  });
});
