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
import { CommunityTheme } from '../communities/entities/community-theme.entity';
import { MemberCommunity } from '../member-communities/entities/member-community.entity';

// members.service와 동일한 cost로 해싱해야 개발 계정으로 로그인이 된다.
const BCRYPT_SALT_ROUNDS = 10;

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
    await this.dataSource.transaction(async (manager) => {
      const members = await this.seedMembers(manager);
      const themes = await this.seedThemes(manager);
      await this.seedCommunities(manager, members, themes);
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
    const communityThemeRepository = manager.getRepository(CommunityTheme);
    const memberCommunityRepository = manager.getRepository(MemberCommunity);

    const [messi, ronaldo, mbappe, yamal, haaland] = members;
    const [politics, economy] = themes;

    // opinion !== null → KEYNOTE_MEMBER, null → NORMAL_MEMBER 로 분류된다.
    // 호스트는 실제 커뮤니티 생성 흐름과 동일하게 자신의 기조 발언과 함께 참여자로 포함한다.
    const communitySeeds = [
      {
        topic: '기본소득 도입에 찬성하는가',
        state: CommunityState.ACTIVE,
        host: messi,
        hostKeynote: {
          opinion: '찬성',
          reasons: ['기본 생계 보장', '소득 양극화 완화'],
        },
        themes: [politics, economy],
        others: [
          {
            member: ronaldo,
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
        topic: '주 4일제 전면 시행이 필요한가',
        state: CommunityState.WAITING,
        host: ronaldo,
        hostKeynote: {
          opinion: '찬성',
          reasons: ['생산성 향상', '워라밸 개선'],
        },
        themes: [economy],
        others: [
          {
            member: haaland,
            opinion: '반대',
            reasons: ['인건비 부담'],
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
          hostNickname: seed.host.nickname,
          memberCount: participants.length,
          topic: seed.topic,
          communityLink: null,
        }),
      );

      await communityThemeRepository.save(
        seed.themes.map((theme) =>
          communityThemeRepository.create({
            communityId: community.id,
            themeId: theme.id,
          }),
        ),
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
}
