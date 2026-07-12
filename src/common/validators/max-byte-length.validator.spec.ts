import { validate } from 'class-validator';
import { MaxByteLength } from './max-byte-length.validator';

class Sample {
  @MaxByteLength(72)
  value: unknown;
}

// UTF-8 인코딩 시 지정한 바이트 수가 되도록 문자를 반복해 만든다.
const build = (value: unknown): Sample => {
  const sample = new Sample();
  sample.value = value;
  return sample;
};

const hasByteLengthError = async (value: unknown): Promise<boolean> => {
  const errors = await validate(build(value));
  return errors.some((error) => error.constraints?.maxByteLength !== undefined);
};

describe('MaxByteLength', () => {
  describe('ASCII (1바이트/문자)', () => {
    it('72바이트 경계는 통과한다', async () => {
      expect(await hasByteLengthError('a'.repeat(72))).toBe(false);
    });

    it('73바이트는 거부한다', async () => {
      expect(await hasByteLengthError('a'.repeat(73))).toBe(true);
    });
  });

  describe('한글 (3바이트/문자)', () => {
    it('24문자=72바이트 경계는 통과한다', async () => {
      expect(await hasByteLengthError('가'.repeat(24))).toBe(false);
    });

    it('25문자=75바이트는 거부한다', async () => {
      expect(await hasByteLengthError('가'.repeat(25))).toBe(true);
    });
  });

  describe('이모지 (4바이트/문자)', () => {
    it('18문자=72바이트 경계는 통과한다', async () => {
      expect(await hasByteLengthError('😀'.repeat(18))).toBe(false);
    });

    it('19문자=76바이트는 거부한다', async () => {
      expect(await hasByteLengthError('😀'.repeat(19))).toBe(true);
    });
  });

  it('문자열이 아니면 거부한다', async () => {
    expect(await hasByteLengthError(12345)).toBe(true);
  });
});
