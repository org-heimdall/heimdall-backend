import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { MemberCommunity } from './entities/member-community.entity';

@Injectable()
export class MemberCommunitiesService {
  constructor(
    @InjectRepository(MemberCommunity)
    private readonly memberCommunityRepository: Repository<MemberCommunity>,
  ) {}

  // 트랜잭션 참여용: manager가 있으면 그 안의 레포지토리를, 없으면 기본 레포지토리를 사용한다.
  private repo(manager?: EntityManager): Repository<MemberCommunity> {
    return manager
      ? manager.getRepository(MemberCommunity)
      : this.memberCommunityRepository;
  }

  // 커뮤니티 참여자(member_community 행) 전체 조회
  async findParticipants(communityId: string): Promise<MemberCommunity[]> {
    return this.repo().findBy({ communityId });
  }

  // 특정 회원의 커뮤니티 참여/기조발언 행 조회 (없으면 null)
  async findOne(
    memberId: string,
    communityId: string,
  ): Promise<MemberCommunity | null> {
    return this.repo().findOneBy({ memberId, communityId });
  }

  // 참여 행 생성(호스트 참여 등록 + 기조발언 등). 커뮤니티 생성 트랜잭션에서 manager로 참여한다.
  async create(
    memberId: string,
    communityId: string,
    opinion: string | null,
    reasons: string[] | null,
    manager?: EntityManager,
  ): Promise<MemberCommunity> {
    const repo = this.repo(manager);
    const row = repo.create({ memberId, communityId, opinion, reasons });
    return repo.save(row);
  }

  // 기조발언 작성/수정: (memberId, communityId) 유니크 제약 기반 upsert로 원자적 처리한다.
  // 충돌 시 opinion/reasons만 갱신, 없으면 참여+작성 행을 생성한다.
  async upsertKeynote(
    memberId: string,
    communityId: string,
    opinion: string,
    reasons: string[],
  ): Promise<MemberCommunity> {
    await this.repo().upsert({ memberId, communityId, opinion, reasons }, [
      'memberId',
      'communityId',
    ]);
    return this.repo().findOneByOrFail({ memberId, communityId });
  }

  // 커뮤니티에 속한 모든 참여 행 삭제(커뮤니티 삭제 시). 삭제 트랜잭션에서 manager로 참여한다.
  async deleteByCommunity(
    communityId: string,
    manager?: EntityManager,
  ): Promise<void> {
    await this.repo(manager).delete({ communityId });
  }
}
