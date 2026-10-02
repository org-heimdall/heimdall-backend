import { DebateSide } from '../debates/debate-turn';
import {
  canonicalizeSideTokens,
  findResidualSideTokens,
  renderSideTokens,
} from './judgment-text';

describe('judgment-text', () => {
  const NAMES = {
    [DebateSide.SIDE_A]: '테테스트',
    [DebateSide.SIDE_B]: 'tester',
  };

  describe('canonicalizeSideTokens', () => {
    it.each([
      ['{{SIDE_A}}의 주장', '{{SIDE_A}}의 주장'],
      ['{{ SIDE_B }}는 답했다', '{{SIDE_B}}는 답했다'],
      ['SIDE_A의 근거', '{{SIDE_A}}의 근거'],
      ['SIDE A와 side-b', '{{SIDE_A}}와 {{SIDE_B}}'],
      [
        'A측은 반박했고 B 측은 답했다',
        '{{SIDE_A}}은 반박했고 {{SIDE_B}}은 답했다',
      ],
      ['측면 A가 우세하다', '{{SIDE_A}}가 우세하다'],
      ['B편의 논증', '{{SIDE_B}}의 논증'],
    ])('%s → %s', (input, expected) => {
      expect(canonicalizeSideTokens(input)).toBe(expected);
    });

    it('이미 정규화된 문장은 그대로다(멱등)', () => {
      const once = canonicalizeSideTokens('SIDE_A와 A측');
      expect(canonicalizeSideTokens(once)).toBe(once);
    });

    it('단어 안쪽이나 소문자 a측, A측면은 건드리지 않는다', () => {
      const text = 'PLANA측 INSIDE_ADVICE a측 A측면 SIDE_AB';
      expect(canonicalizeSideTokens(text)).toBe(text);
    });
  });

  describe('renderSideTokens', () => {
    it('placeholder와 레거시 표기를 닉네임으로 바꾼다', () => {
      expect(
        renderSideTokens(
          '{{SIDE_A}}는 근거가 강했고 SIDE_B는 질문에 답하지 못했다.',
          NAMES,
        ),
      ).toBe('테테스트는 근거가 강했고 tester는 질문에 답하지 못했다.');
    });
  });

  describe('findResidualSideTokens', () => {
    it('흔한 변형은 정규화로 흡수되어 남지 않는다', () => {
      expect(findResidualSideTokens('{{SIDE_A}}와 SIDE_B, A측')).toEqual([]);
    });

    it('정규화가 흡수하지 못한 SIDE 흔적과 깨진 중괄호를 돌려준다', () => {
      expect(findResidualSideTokens('SIDE_AB 대 {{SIDE_C}}')).toEqual([
        'SIDE_A',
        '{{',
        '}}',
      ]);
    });
  });
});
