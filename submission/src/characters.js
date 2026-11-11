export const CHARACTER_ORDER = ['falcon', 'ash', 'agent46'];
export const DEFAULT_CHARACTER_ID = 'falcon';

export const CHARACTERS = {
  falcon: {
    id: 'falcon',
    name: '游隼',
    title: '特种兵',
    color: 0x4b8eff,
    cssColor: '#4b8eff',
    passive: '滑铲距离 +35%',
    skill1: {
      name: '战术闪光弹',
      key: 'Q',
      uses: 5,
      description: '投出闪光弹，1.5 秒后激发。',
    },
    skill2: {
      name: '战术干扰波',
      key: 'E',
      ultimate: true,
      energyCost: 100,
      castMs: 5000,
      durationMs: 16000,
      radius: 600,
      spreadMultiplier: 1.75,
      description: '充能后读条，干扰附近敌人的射击。',
    },
  },
  ash: {
    id: 'ash',
    name: '灰烬',
    title: '机枪手',
    color: 0xefe7d3,
    cssColor: '#efe7d3',
    passive: '受到伤害 -20% · 狙击无法瞄准',
    skill1: {
      name: '燃烧',
      key: 'Q',
      ultimate: true,
      energyCost: 100,
      durationMs: 20000,
      description: '充能后持续 20 秒，机枪伤害翻倍。',
    },
    skill2: {
      name: '专注',
      key: 'E',
      description: '每秒消耗 10 体力，强化机枪射击。',
    },
  },
  agent46: {
    id: 'agent46',
    name: '46号',
    title: '杀手',
    color: 0xf05b3d,
    cssColor: '#f05b3d',
    passive: '潜行无声 · 非疾跑移速 -25%',
    skill1: {
      name: '侦查',
      key: 'Q',
      ultimate: true,
      energyCost: 100,
      durationMs: 4000,
      description: '4 秒看见全图敌人位置与视野轮廓。',
    },
    skill2: {
      name: '偷袭',
      key: 'X',
      description: '贴近目标背后按 X 秒杀。',
    },
  },
};

export function getCharacterDefinition(characterId) {
  return CHARACTERS[characterId] ?? null;
}
