import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Member } from '../members/entities/member.entity';
import { Theme } from '../communities/entities/theme.entity';
import {
  Community,
  CommunityState,
} from '../communities/entities/community.entity';
import { MemberCommunity } from '../member-communities/entities/member-community.entity';
import { Debate, DebateTurn } from '../debates/entities/debate.entity';
import { DebateMessage } from '../debates/entities/debate-message.entity';
import { ResourceStatus } from '../common/entities/resource-status.enum';
import { DebateSeed, DebateSeedSource } from './debate-seed.source';

// members.service와 동일한 cost로 해싱해야 개발 계정으로 로그인이 된다.
const BCRYPT_SALT_ROUNDS = 10;

// 대화 시드는 건수가 많아 한 INSERT에 다 넣으면 파라미터 수 상한(65535)에 걸릴 수 있다.
const DEBATE_MESSAGE_INSERT_CHUNK = 500;

// 개발용 시드 계정 공통 비밀번호(평문). 실제 저장 시 해싱된다.
const SEED_PASSWORD = 'password1234';

// email/nickname은 seedMembers에서 멱등 판별 키(email)로 쓰인다.
const MEMBER_SEEDS: Pick<
  Member,
  'email' | 'nickname' | 'gender' | 'age' | 'profileImageUrl'
>[] = [
  {
    email: 'user1@example.com',
    nickname: '메시',
    gender: 'MALE',
    age: 40,
    profileImageUrl: 'https://cdn.example.com/profile/goat.png',
  },
  {
    email: 'user2@example.com',
    nickname: '호날두',
    gender: 'MALE',
    age: 39,
    profileImageUrl: 'https://cdn.example.com/profile/siu.png',
  },
  {
    email: 'user3@example.com',
    nickname: '음바페',
    gender: 'MALE',
    age: 24,
    profileImageUrl: 'https://cdn.example.com/profile/france.png',
  },
  {
    email: 'user4@example.com',
    nickname: '야말',
    gender: 'MALE',
    age: 22,
    profileImageUrl: 'https://cdn.example.com/profile/spain.png',
  },
  {
    email: 'user5@example.com',
    nickname: '홀란드',
    gender: 'MALE',
    age: 25,
    profileImageUrl: 'https://cdn.example.com/profile/spain.png',
  },
];

// name이 seedThemes의 멱등 판별 키다.
const THEME_SEEDS: string[] = [
  '정치',
  '경제',
  '사회',
  '문화',
  '스포츠',
  '일상',
  '코미디',
  '기타',
];

@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly debateSeedSource: DebateSeedSource,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // NODE_ENV=development 일 때만 시드를 주입 (production/test 제외).
    if (this.configService.get<string>('NODE_ENV') !== 'development') {
      return;
    }
    await this.seed();
  }

  // 테스트용 기초 데이터를 한 트랜잭션 안에서 멱등하게 주입한다.
  async seed(): Promise<void> {
    // 파일 IO로 트랜잭션을 붙잡고 있지 않도록 대화 시드는 트랜잭션 밖에서 미리 읽는다.
    const debateSeeds = await this.debateSeedSource.load();

    await this.dataSource.transaction(async (manager) => {
      const members = await this.seedMembers(manager);
      const themes = await this.seedThemes(manager);
      await this.seedCommunities(manager, members, themes);
      await this.seedDebates(manager, members, debateSeeds);
    });
    this.logger.log('개발용 시드 데이터 준비 완료');
  }

  // email로 존재를 확인해 없는 계정만 생성한다. 항상 전체 시드 계정을 반환한다.
  private async seedMembers(manager: EntityManager): Promise<Member[]> {
    const repository = manager.getRepository(Member);
    const password = await bcrypt.hash(SEED_PASSWORD, BCRYPT_SALT_ROUNDS);

    const members: Member[] = [];
    for (const seed of MEMBER_SEEDS) {
      let member = await repository.findOneBy({ email: seed.email });
      if (!member) {
        member = await repository.save(
          repository.create({ ...seed, password }),
        );
      }
      members.push(member);
    }
    return members;
  }

  // name으로 존재를 확인해 없는 테마만 생성한다. 항상 전체 시드 테마를 반환한다.
  private async seedThemes(manager: EntityManager): Promise<Theme[]> {
    const repository = manager.getRepository(Theme);

    const themes: Theme[] = [];
    for (const name of THEME_SEEDS) {
      let theme = await repository.findOneBy({ name });
      if (!theme) {
        theme = await repository.save(repository.create({ name }));
      }
      themes.push(theme);
    }
    return themes;
  }

  // 커뮤니티는 topic으로 존재를 확인해, 없을 때만 테마 연결·참여자와 함께 생성한다.
  private async seedCommunities(
    manager: EntityManager,
    members: Member[],
    themes: Theme[],
  ): Promise<void> {
    const communityRepository = manager.getRepository(Community);
    const memberCommunityRepository = manager.getRepository(MemberCommunity);

    const [messi, ronaldo, mbappe, yamal, haaland] = members;
    const [politics, economy] = themes;

    // opinion !== null → KEYNOTE_MEMBER, null → NORMAL_MEMBER 로 분류된다.
    // 호스트는 실제 커뮤니티 생성 흐름과 동일하게 자신의 기조 발언과 함께 참여자로 포함한다.
    const communitySeeds = [
      {
        topic: '기본소득 도입에 찬성하는가',
        state: CommunityState.ACTIVE,
        host: messi, // user1
        hostKeynote: {
          opinion: '찬성',
          reasons: ['기본 생계 보장', '소득 양극화 완화'],
        },
        theme: politics,
        debateRoundCount: 6,
        others: [
          {
            member: ronaldo, // user2
            opinion: '반대',
            reasons: ['재원 부담', '근로 의욕 저하 우려'],
          },
          {
            member: mbappe,
            opinion: '찬성',
            reasons: ['소비 진작 효과'],
          },
          // opinion 미작성 → NORMAL_MEMBER
          {
            member: yamal,
            opinion: null,
            reasons: null,
          },
        ],
      },
      {
        topic: '선거운동 가능 연령을 16세로 하향하여야 하는가',
        state: CommunityState.WAITING,
        host: ronaldo, // user2
        hostKeynote: {
          opinion: '찬성',
          reasons: ['정당가입 가능'],
        },
        theme: politics,
        debateRoundCount: 3,
        others: [
          {
            member: haaland, // user5
            opinion: '반대',
            reasons: ['학교 내 갈등'],
          },
        ],
      },
      {
        topic: '국민연금 의무가입을 폐지하여야 한다',
        state: CommunityState.WAITING,
        host: ronaldo, // user2
        hostKeynote: {
          opinion: '찬성',
          reasons: ['고갈 우려', '재정 불안정'],
        },
        theme: economy,
        debateRoundCount: 12,
        others: [
          {
            member: haaland, // user5
            opinion: '반대',
            reasons: ['노인 빈곤 완화 효과'],
          },
        ],
      },
    ];

    for (const seed of communitySeeds) {
      const exists = await communityRepository.exists({
        where: { topic: seed.topic },
      });
      if (exists) {
        continue;
      }

      // 호스트를 첫 참여자로 두어 member_community에 반드시 행이 생기게 한다.
      const participants = [
        {
          member: seed.host,
          opinion: seed.hostKeynote.opinion,
          reasons: seed.hostKeynote.reasons,
        },
        ...seed.others,
      ];

      const community = await communityRepository.save(
        communityRepository.create({
          state: seed.state,
          hostId: seed.host.id,
          themeId: seed.theme.id,
          memberCount: participants.length,
          topic: seed.topic,
          debateRoundCount: seed.debateRoundCount,
          communityLink: null,
        }),
      );

      await memberCommunityRepository.save(
        participants.map((participant) =>
          memberCommunityRepository.create({
            memberId: participant.member.id,
            communityId: community.id,
            opinion: participant.opinion,
            reasons: participant.reasons,
          }),
        ),
      );
    }
  }

  // 대화 시드는 UUID 대신 자연키(커뮤니티 topic·회원 email)로 작성되므로 여기서 FK로 해석한다.
  // 커뮤니티당 토론 1건을 멱등 기준으로 삼아, 이미 토론이 있으면 통째로 건너뛴다.
  private async seedDebates(
    manager: EntityManager,
    members: Member[],
    seeds: DebateSeed[],
  ): Promise<void> {
    if (seeds.length === 0) {
      return;
    }

    const communityRepository = manager.getRepository(Community);
    const debateRepository = manager.getRepository(Debate);
    const messageRepository = manager.getRepository(DebateMessage);
    const memberByEmail = new Map(
      members.map((member) => [member.email, member]),
    );

    for (const seed of seeds) {
      const community = await communityRepository.findOneBy({
        topic: seed.communityTopic,
        status: ResourceStatus.NORMAL,
      });
      if (!community) {
        // topic은 커뮤니티 시드에 이미 커밋된 값이라 로그에 남겨도 비공개 데이터가 아니다.
        this.logger.warn(
          `대화 시드의 커뮤니티를 찾지 못해 건너뜁니다: ${seed.communityTopic}`,
        );
        continue;
      }

      const alreadySeeded = await debateRepository.exists({
        where: { communityId: community.id, status: ResourceStatus.NORMAL },
      });
      if (alreadySeeded) {
        continue;
      }

      const host = this.requireSeedMember(memberByEmail, seed.hostEmail);
      const opponent = this.requireSeedMember(
        memberByEmail,
        seed.opponentEmail,
      );

      // 판정 전 상태로 넣는다(winnerId·solution은 debate-judge가 채운다).
      // currentTurn은 종료된 대화에선 의미가 없어 기본값 HOST로 둔다.
      const debate = await debateRepository.save(
        debateRepository.create({
          communityId: community.id,
          hostId: host.id,
          hostNickname: host.nickname,
          opponentId: opponent.id,
          opponentNickname: opponent.nickname,
          currentTurn: DebateTurn.HOST,
        }),
      );

      const rows = seed.messages.map((message) => ({
        memberId: this.requireSeedMember(memberByEmail, message.email).id,
        debateId: debate.id,
        body: message.body,
        debate_turn: message.turn,
      }));

      // 건수가 많아 save 루프 대신 벌크 insert로 넣는다(엔티티 인스턴스 생성 비용도 없다).
      for (let i = 0; i < rows.length; i += DEBATE_MESSAGE_INSERT_CHUNK) {
        await messageRepository.insert(
          rows.slice(i, i + DEBATE_MESSAGE_INSERT_CHUNK),
        );
      }
      this.logger.log(
        `대화 시드 주입 완료 (${seed.communityTopic}, ${rows.length}건)`,
      );
    }
  }

  // 시드 파일이 참조한 이메일이 시드 계정에 없으면 FK 위반 대신 원인이 드러나는 에러로 끊는다.
  private requireSeedMember(
    memberByEmail: Map<string, Member>,
    email: string,
  ): Member {
    const member = memberByEmail.get(email);
    if (!member) {
      throw new Error(`대화 시드가 참조한 시드 계정이 없습니다: ${email}`);
    }
    return member;
  }
}
