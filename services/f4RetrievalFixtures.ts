import type { RagChunk } from '../types';
import { buildMaterialChunks, createMaterialDocument } from './materialDocumentService';

export interface F4MaterialFixture {
  id: string;
  fileName: string;
  title: string;
  documentId: string;
  chunks: RagChunk[];
}

export interface F4QueryLabel {
  id: string;
  query: string;
  expectedDocumentId?: string;
  answerable: boolean;
}

const materialSeeds = [
  [
    'algebra-linear.md',
    'Linear equations / 一次方程式',
    'Solve ax + b = 0 by isolating x.\n一次方程式 ax + b = 0 的解法是先移項，再除以非零係數。',
  ],
  [
    'algebra-quadratic.md',
    'Quadratic formula / 一元二次公式',
    'The quadratic formula solves ax² + bx + c = 0.\n一元二次方程式可使用公式 x = (-b ± √(b²-4ac)) / 2a。',
  ],
  [
    'geometry-triangle.md',
    'Triangle area / 三角形面積',
    'Triangle area equals base times height divided by two.\n三角形面積等於底乘高再除以二。',
  ],
  [
    'geometry-circle.md',
    'Circle circumference / 圓周長',
    'Circumference is 2πr and area is πr².\n圓周長是 2πr，面積是 πr²。',
  ],
  [
    'physics-motion.md',
    'Motion / 運動學',
    'Velocity is displacement divided by elapsed time.\n速度是位移除以經過時間，加速度描述速度變化率。',
  ],
  [
    'physics-energy.md',
    'Energy / 能量',
    'Kinetic energy is one half mv squared.\n動能是二分之一乘質量乘速度平方。',
  ],
  [
    'chemistry-acid.md',
    'Acids and bases / 酸鹼',
    'A lower pH indicates a more acidic solution.\npH 越低表示溶液越酸，指示劑可協助判斷酸鹼性。',
  ],
  [
    'chemistry-atom.md',
    'Atomic structure / 原子結構',
    'Protons are positive, electrons are negative, and neutrons are neutral.\n質子帶正電、電子帶負電、中子不帶電。',
  ],
  [
    'biology-cell.md',
    'Cell structure / 細胞結構',
    'The nucleus stores genetic information and mitochondria release usable energy.\n細胞核儲存遺傳資訊，粒線體釋放可用能量。',
  ],
  [
    'biology-ecosystem.md',
    'Ecosystems / 生態系',
    'Energy flows from producers to consumers and decomposers.\n能量由生產者流向消費者與分解者，物質則循環。',
  ],
  [
    'earth-water.md',
    'Water cycle / 水循環',
    'Evaporation, condensation, precipitation, and collection form the water cycle.\n蒸發、凝結、降水與集水構成水循環。',
  ],
  [
    'earth-weather.md',
    'Weather fronts / 天氣鋒面',
    'A cold front forms when cold air advances under warm air.\n冷鋒是冷空氣推進並抬升暖空氣時形成的鋒面。',
  ],
  [
    'history-printing.md',
    'Printing press / 印刷術',
    'Movable type made books easier to reproduce and distribute.\n活字印刷讓書籍更容易複製與傳播，促進知識流通。',
  ],
  [
    'history-trade.md',
    'Trade routes / 貿易路線',
    'Trade routes exchange goods, technologies, languages, and ideas.\n貿易路線交換商品、技術、語言與思想。',
  ],
  [
    'civics-rights.md',
    'Rights and duties / 權利與義務',
    'Rights are balanced with responsibilities toward the community.\n公民權利通常與對社群的責任相互平衡。',
  ],
  [
    'civics-law.md',
    'Rule of law / 法治',
    'The rule of law requires public rules to apply predictably and equally.\n法治要求公開規則可預期且平等適用。',
  ],
  [
    'language-argument.md',
    'Argument structure / 論證結構',
    'A clear argument states a claim, evidence, and reasoning.\n清楚的論證包含主張、證據與推理。',
  ],
  [
    'language-metaphor.md',
    'Metaphor / 隱喻',
    'A metaphor compares unlike things to create a new perspective.\n隱喻以不同事物的比較創造新的理解角度。',
  ],
  [
    'computer-algorithm.md',
    'Algorithms / 演算法',
    'An algorithm is a finite sequence of steps that transforms input into output.\n演算法是將輸入轉為輸出的有限步驟序列。',
  ],
  [
    'computer-privacy.md',
    'Privacy / 隱私',
    'Data minimization collects only what a task needs and limits unnecessary exposure.\n資料最小化只蒐集任務所需內容，降低不必要的暴露。',
  ],
] as const;

export const F4_MATERIAL_FIXTURES: F4MaterialFixture[] = materialSeeds.map(
  ([fileName, title, content], index) => {
    const document = createMaterialDocument({
      fileName,
      content,
      documentId: `f4-material-${index + 1}`,
      sourceType: 'file',
    });
    return {
      id: `material-${index + 1}`,
      fileName,
      title,
      documentId: document.documentId,
      chunks: buildMaterialChunks(document, [{ content, sourceLocation: { paragraph: 1 } }]),
    };
  },
);

const querySeeds: Array<{ query: string; fixtureIndex?: number }> = [
  { query: 'solve linear equation', fixtureIndex: 0 },
  { query: '一次方程式怎麼解', fixtureIndex: 0 },
  { query: 'quadratic formula', fixtureIndex: 1 },
  { query: '一元二次公式', fixtureIndex: 1 },
  { query: 'triangle area', fixtureIndex: 2 },
  { query: '三角形面積', fixtureIndex: 2 },
  { query: 'circle circumference', fixtureIndex: 3 },
  { query: '圓周長公式', fixtureIndex: 3 },
  { query: 'velocity displacement', fixtureIndex: 4 },
  { query: '速度與位移', fixtureIndex: 4 },
  { query: 'kinetic energy', fixtureIndex: 5 },
  { query: '動能公式', fixtureIndex: 5 },
  { query: 'acidic pH', fixtureIndex: 6 },
  { query: 'pH 酸鹼', fixtureIndex: 6 },
  { query: 'positive proton', fixtureIndex: 7 },
  { query: '質子 電子 中子', fixtureIndex: 7 },
  { query: 'mitochondria energy', fixtureIndex: 8 },
  { query: '細胞核 粒線體', fixtureIndex: 8 },
  { query: 'ecosystem decomposer', fixtureIndex: 9 },
  { query: '生態系 分解者', fixtureIndex: 9 },
  { query: 'water cycle precipitation', fixtureIndex: 10 },
  { query: '水循環 降水', fixtureIndex: 10 },
  { query: 'cold front', fixtureIndex: 11 },
  { query: '冷鋒 暖空氣', fixtureIndex: 11 },
  { query: 'movable type books', fixtureIndex: 12 },
  { query: '活字印刷', fixtureIndex: 12 },
  { query: 'trade route ideas', fixtureIndex: 13 },
  { query: '貿易路線 技術', fixtureIndex: 13 },
  { query: 'rights responsibility', fixtureIndex: 14 },
  { query: '權利 責任', fixtureIndex: 14 },
  { query: 'rule of law', fixtureIndex: 15 },
  { query: '法治 平等', fixtureIndex: 15 },
  { query: 'claim evidence reasoning', fixtureIndex: 16 },
  { query: '主張 證據 推理', fixtureIndex: 16 },
  { query: 'metaphor perspective', fixtureIndex: 17 },
  { query: '隱喻 比較', fixtureIndex: 17 },
  { query: 'algorithm input output', fixtureIndex: 18 },
  { query: '演算法 輸入 輸出', fixtureIndex: 18 },
  { query: 'data minimization privacy', fixtureIndex: 19 },
  { query: '資料最小化 隱私', fixtureIndex: 19 },
  { query: 'what is acceleration', fixtureIndex: 4 },
  { query: '速度變化率', fixtureIndex: 4 },
  { query: 'what makes a solution acidic', fixtureIndex: 6 },
  { query: '細胞的遺傳資訊在哪裡', fixtureIndex: 8 },
  { query: 'how does energy move in an ecosystem', fixtureIndex: 9 },
  { query: '哪些因素形成冷鋒', fixtureIndex: 11 },
  { query: 'why did printing matter', fixtureIndex: 12 },
  { query: '法治是什麼', fixtureIndex: 15 },
  { query: 'what is a finite step sequence', fixtureIndex: 18 },
  { query: 'unrelated topic with no answer' },
];

export const F4_QUERY_LABELS: F4QueryLabel[] = querySeeds.map((seed, index) => ({
  id: `f4-query-${index + 1}`,
  query: seed.query,
  ...(seed.fixtureIndex === undefined
    ? { answerable: false }
    : {
        expectedDocumentId: F4_MATERIAL_FIXTURES[seed.fixtureIndex].documentId,
        answerable: true,
      }),
}));

export const F4_RETRIEVAL_TARGET_TOP5 = 0.85;
export const F4_RETRIEVAL_CHUNKS = F4_MATERIAL_FIXTURES.flatMap(fixture => fixture.chunks);
