import { Injectable, Logger } from '@nestjs/common';
import { DebateSide, resolveSpeakers } from '../debates/debate-turn';
import { Debate } from '../debates/entities/debate.entity';
import { MembersService } from '../members/members.service';
import { hashClaim } from './claim-normalizer';
import {
  FactCheckResultDto,
  JudgmentParticipantDto,
  JudgmentResultDto,
} from './dto/debate-result.dto';
import { DebateJudgmentResult } from './entities/debate-judgment-result.entity';
import { JudgeResultRepository } from './judge-result.repository';
import { VerificationStatus } from './judge.types';
import { findResidualSideTokens, renderSideTokens } from './judgment-text';

// 결과 카드로 내보내지 않는 검증 결과. "검증 대상이 아니다"라는 결론은 판정 입력에만 쓴다.
const HIDDEN_CARD_STATUSES: ReadonlySet<VerificationStatus> = new Set([
  VerificationStatus.NOT_VERIFIABLE,
]);

/**
 * 저장된 판정·사실 검증 결과를 화면용 응답으로 바꾼다.
 *
 * DB에는 LLM 원문이 그대로 남아 있고(감사용), 화면에 나갈 문장만 여기서 참여자 닉네임으로 렌더링한다.
 * 그래서 닉네임을 바꿔도, 이 규칙이 생기기 전의 판정(SIDE_A 노출분)이라도 읽을 때 함께 고쳐진다.
 * 검증 카드도 같은 이유로 읽을 때 거른다(이전 데이터의 중복 카드까지 정리된다).
 */
@Injectable()
export class DebateResultPresenter {
  private readonly logger = new Logger(DebateResultPresenter.name);

  constructor(
    private readonly members: MembersService,
    private readonly results: JudgeResultRepository,
  ) {}

  /**
   * 결과 화면의 사실 검증 카드. 원본 발언 순서대로 내보내고,
   * 검증 대상이 아니라는 결론(NOT_VERIFIABLE)과 같은 주장의 중복 카드는 뺀다.
   */
  async presentFactChecks(debateId: string): Promise<FactCheckResultDto[]> {
    const checks = await this.results.findFactChecks(debateId);
    if (checks.length === 0) {
      return [];
    }
    const checkByComponentId = new Map(
      checks.map((check) => [check.componentId, check]),
    );

    // findComponents가 발언 순서로 돌려주므로 그 순서가 곧 카드 순서다.
    // 재분석으로 컴포넌트가 교체되어 결과만 남은 경우는 보여 줄 문장이 없어 자연히 빠진다.
    const seenClaims = new Set<string>();
    const cards: FactCheckResultDto[] = [];
    for (const component of await this.results.findComponents(debateId)) {
      const check = checkByComponentId.get(component.id);
      if (check === undefined || HIDDEN_CARD_STATUSES.has(check.status)) {
        continue;
      }
      const claim =
        component.claimHash ??
        hashClaim(component.factCheckStatement ?? component.statement);
      if (seenClaims.has(claim)) {
        continue;
      }
      seenClaims.add(claim);
      cards.push(FactCheckResultDto.from(check, component));
    }
    return cards;
  }

  async presentJudgment(
    debate: Debate,
    judgment: DebateJudgmentResult,
  ): Promise<JudgmentResultDto> {
    const participants = await this.loadParticipants(debate);
    const names: Record<DebateSide, string> = {
      [DebateSide.SIDE_A]: participants[DebateSide.SIDE_A].nickname,
      [DebateSide.SIDE_B]: participants[DebateSide.SIDE_B].nickname,
    };
    const render = (text: string): string =>
      this.renderChecked(debate.id, text, names);

    return JudgmentResultDto.from(judgment, {
      participants,
      overallReason: render(judgment.overallReason),
      sideAFeedback: render(judgment.sideAFeedback),
      sideBFeedback: render(judgment.sideBFeedback),
    });
  }

  /**
   * 두 편의 참여자 정보. 회원의 현재 프로필을 쓰고, 찾지 못하면(탈퇴 등) 토론을 만들 때 복사해 둔
   * 닉네임으로 대신한다 — 결과 화면이 회원 상태 때문에 깨지면 안 된다.
   */
  private async loadParticipants(
    debate: Debate,
  ): Promise<Record<DebateSide, JudgmentParticipantDto>> {
    const speakers = resolveSpeakers(debate);
    if (speakers === null) {
      // 판정은 상대가 있는 토론에서만 만들어지므로 여기 오면 데이터 이상이다.
      throw new Error(`상대가 없는 토론의 판정입니다: debateId=${debate.id}`);
    }

    const members = await this.members.findByIds(Object.values(speakers));
    const memberById = new Map(members.map((member) => [member.id, member]));
    const snapshotNickname: Record<DebateSide, string> = {
      [DebateSide.SIDE_A]: debate.hostNickname,
      [DebateSide.SIDE_B]: debate.opponentNickname ?? '',
    };

    const toParticipant = (side: DebateSide): JudgmentParticipantDto => {
      const memberId = speakers[side];
      const member = memberById.get(memberId);
      return Object.assign(new JudgmentParticipantDto(), {
        side,
        memberId,
        nickname: member?.nickname ?? snapshotNickname[side],
        profileImageUrl: member?.profileImageUrl ?? null,
      });
    };

    return {
      [DebateSide.SIDE_A]: toParticipant(DebateSide.SIDE_A),
      [DebateSide.SIDE_B]: toParticipant(DebateSide.SIDE_B),
    };
  }

  // 렌더링 뒤에도 side 흔적이 남았으면 규칙이 놓친 표기다. 응답은 그대로 내보내고 고칠 근거만 남긴다.
  private renderChecked(
    debateId: string,
    text: string,
    names: Record<DebateSide, string>,
  ): string {
    const rendered = renderSideTokens(text, names);
    const residual = findResidualSideTokens(rendered);
    if (residual.length > 0) {
      this.logger.error(
        `판정 문장에 변환되지 않은 side 표기가 남았습니다: debateId=${debateId}, tokens=${residual.join(',')}`,
      );
    }
    return rendered;
  }
}
