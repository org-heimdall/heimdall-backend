// 현재 시각 공급자. 시간에 따라 결과가 갈리는 서비스(만료 판정 등)가 주입받아 쓰면
// 테스트가 시각을 고정할 수 있다.
export type Clock = () => Date;

export const CLOCK = Symbol('CLOCK');

export const systemClock: Clock = () => new Date();
