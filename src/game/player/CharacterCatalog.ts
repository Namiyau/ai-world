/** Shared pure data for visible characters and the future player-model pipeline. */
export type CharacterRole = "explorer" | "merchant" | "wildernessEnemy";

export const CHARACTER_MODULE_SLOTS = [
  "hair",
  "headwear",
  "outfit",
  "lowerBody",
  "footwear",
  "carry",
  "prop",
] as const;

export type CharacterModuleSlot = (typeof CHARACTER_MODULE_SLOTS)[number];

export interface CharacterAppearance {
  style: "stylized-low-poly";
  outfit: "wilderness-explorer" | "working-merchant" | "wilderness-raider";
  proportions: {
    bodyScale: number;
    headScale: number;
    shoulderScale: number;
  };
  palette: {
    jacket: string;
    pack: string;
    trousers: string;
    boots: string;
    skin: string;
    hair: string;
    accent: string;
  };
  modules: Record<CharacterModuleSlot, string>;
}

export interface CharacterDescriptor {
  id: string;
  role: CharacterRole;
  displayName: string;
  appearance: CharacterAppearance;
  views: {
    front: string;
    side: string;
    back: string;
  };
}

const explorer: CharacterDescriptor = {
  id: "player-explorer",
  role: "explorer",
  displayName: "玩家探索者",
  appearance: {
    style: "stylized-low-poly",
    outfit: "wilderness-explorer",
    proportions: { bodyScale: 1, headScale: 1.16, shoulderScale: 1.08 },
    palette: { jacket: "#607f58", pack: "#72583c", trousers: "#39484a", boots: "#2d2925", skin: "#d6a27b", hair: "#3b2c24", accent: "#a7b28d" },
    modules: {
      hair: "short-practical",
      headwear: "none",
      outfit: "utility-jacket",
      lowerBody: "cargo-trousers",
      footwear: "field-boots",
      carry: "waist-pack-small-backpack",
      prop: "none",
    },
  },
  views: {
    front: "橄榄绿实用夹克、暖棕腰包、深灰工装裤和棕色靴子，短发让脸部轮廓清晰。",
    side: "背部小背包略微鼓出，腰包、手臂和靴底形成清楚横向层次，适合自动骨骼绑定。",
    back: "夹克后背有简化浅色织带和背包主体，裤腿与靴子颜色分离，远处仍保持识别度。",
  },
};

const merchant: CharacterDescriptor = {
  id: "ordinary-merchant",
  role: "merchant",
  displayName: "普通商人",
  appearance: {
    style: "stylized-low-poly",
    outfit: "working-merchant",
    proportions: { bodyScale: 1.05, headScale: 1.12, shoulderScale: 1.12 },
    palette: { jacket: "#b98649", pack: "#8f6744", trousers: "#55463b", boots: "#3d3029", skin: "#cf9870", hair: "#473329", accent: "#ded0ab" },
    modules: {
      hair: "side-part",
      headwear: "wide-brim-hat",
      outfit: "merchant-coat",
      lowerBody: "work-trousers",
      footwear: "merchant-boots",
      carry: "cross-body-goods-bag",
      prop: "price-board",
    },
  },
  views: {
    front: "赭黄色短外套配米色衬衣，宽檐帽和胸前挂牌明确职业感。",
    side: "一侧斜挎货包，手边可挂小账本或短木牌，整体轮廓比玩家更方正稳定。",
    back: "帽檐、外套下摆和货包形成三个明确背面层次，不依赖单纯换色识别职业。",
  },
};

const wildernessEnemy: CharacterDescriptor = {
  id: "wilderness-melee-enemy",
  role: "wildernessEnemy",
  displayName: "荒野近战敌人",
  appearance: {
    style: "stylized-low-poly",
    outfit: "wilderness-raider",
    proportions: { bodyScale: 1.04, headScale: 1.12, shoulderScale: 1.18 },
    palette: { jacket: "#89564b", pack: "#ad765d", trousers: "#48474a", boots: "#312d2c", skin: "#bd805f", hair: "#302722", accent: "#625f58" },
    modules: {
      hair: "rough-short",
      headwear: "patched-cap",
      outfit: "worn-jacket",
      lowerBody: "patched-trousers",
      footwear: "heavy-boots",
      carry: "single-strap",
      prop: "short-club",
    },
  },
  views: {
    front: "褪色红棕短外套、不对称护肩、灰色旧裤和厚靴，面部保持中性不做恐怖化。",
    side: "一侧手臂带旧护腕，腰侧挂短棒，身体轻微前倾表达近战姿态。",
    back: "破旧披布或补丁布块与单侧背带打破对称，但仍保持低面数清晰轮廓。",
  },
};

export const CHARACTER_CATALOG: Record<CharacterRole, CharacterDescriptor> = {
  explorer,
  merchant,
  wildernessEnemy,
};

export function characterDescriptor(role: CharacterRole): CharacterDescriptor {
  return CHARACTER_CATALOG[role];
}
