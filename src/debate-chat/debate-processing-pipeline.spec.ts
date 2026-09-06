import { DebateChatPublisher } from './debate-chat.publisher';
import {
  DebateProcessingStage,
  DebateProcessingStageStatus,
} from './debate-chat.types';
import { MockDebateProcessingPipeline } from './debate-processing-pipeline';

describe('MockDebateProcessingPipeline', () => {
  it('ANALYZER → FACT_CHECK → JUDGE 순으로 STARTED/COMPLETED를 발행한다', async () => {
    const publisher = { processingStage: jest.fn() };
    const pipeline = new MockDebateProcessingPipeline(
      publisher as unknown as DebateChatPublisher,
    );

    await pipeline.start('debate-uuid');

    const calls = publisher.processingStage.mock.calls.map(
      ([payload]: [{ stage: string; status: string; debateId: string }]) => [
        payload.stage,
        payload.status,
      ],
    );
    const S = DebateProcessingStageStatus;
    expect(calls).toEqual([
      [DebateProcessingStage.ANALYZER, S.STARTED],
      [DebateProcessingStage.ANALYZER, S.COMPLETED],
      [DebateProcessingStage.FACT_CHECK, S.STARTED],
      [DebateProcessingStage.FACT_CHECK, S.COMPLETED],
      [DebateProcessingStage.JUDGE, S.STARTED],
      [DebateProcessingStage.JUDGE, S.COMPLETED],
    ]);
    const [first] = publisher.processingStage.mock.calls[0] as [
      { debateId: string; attempt: number },
    ];
    expect(first).toMatchObject({ debateId: 'debate-uuid', attempt: 1 });
  });
});
