import React, { useState } from 'react';

export interface AssistantTemplate {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  icon: string;
  badge: string;
  gradient: string;
  borderGlow: string;
  badgeColor: string;
}

const ASSISTANT_TEMPLATES: AssistantTemplate[] = [
  {
    id: 'tpl_english_teaching',
    name: '英文教學',
    description: '協助設計英語教案、編寫分級教材、命製聽說讀寫評量，並拆解文法與字彙用法。',
    systemPrompt:
      '你是一位專業的英語教學顧問與備課助手，擁有豐富的 EFL（以英語為外語）教學經驗，熟悉國小至高中各學習階段的英語課綱。你擅長協助教師設計教學活動、編寫分級教材、命製聽說讀寫評量題目，並用淺顯的方式拆解文法觀念與字彙用法。在回應時請：1) 依據學生的程度（初階／中階／進階）調整內容難度與字彙；2) 提供具體可用的教學步驟、情境範例與互動活動；3) 適時附上英文例句與中文翻譯，並標註常見錯誤與學習陷阱；4) 以繁體中文說明為主，必要時輔以英文原文。',
    icon: '🔤',
    badge: '語文領域',
    gradient:
      'from-amber-500/20 to-orange-500/5 hover:from-amber-500/30 hover:to-orange-500/10 border-amber-500/20',
    borderGlow:
      'group-hover:border-amber-500/50 shadow-[0_4px_20px_-4px_rgba(245,158,11,0.15)] group-hover:shadow-[0_4px_25px_0px_rgba(245,158,11,0.25)]',
    badgeColor: 'bg-amber-500/20 text-amber-300 border border-amber-500/30',
  },
  {
    id: 'tpl_math_teaching',
    name: '數學教學',
    description: '轉化抽象數學概念為直覺理解，設計分級練習題、逐步解題示範並指出常見迷思。',
    systemPrompt:
      '你是一位資深的數學教學專家，熟悉國小到高中數學各單元的課綱與學習進程。你擅長將抽象的數學概念轉化為具體、可理解的想法，協助教師設計教學活動、編擬分級練習題與評量、並提供逐步且嚴謹的解題示範。在回應時請：1) 先以直觀方式建立概念直覺，再進入形式化的數學語言與符號；2) 提供多種解法並比較其適用情境；3) 清楚標示學生常見的迷思（misconceptions）與易錯點；4) 使用 Markdown 數學符號或逐步算則（直式）排版，讓計算過程清晰易讀；5) 依據學習階段調整難度，並延伸思考題或生活應用題。',
    icon: '📐',
    badge: '數理領域',
    gradient:
      'from-blue-500/20 to-indigo-500/5 hover:from-blue-500/30 hover:to-indigo-500/10 border-blue-500/20',
    borderGlow:
      'group-hover:border-blue-500/50 shadow-[0_4px_20px_-4px_rgba(59,130,246,0.15)] group-hover:shadow-[0_4px_25px_0px_rgba(59,130,246,0.25)]',
    badgeColor: 'bg-blue-500/20 text-blue-300 border border-blue-500/30',
  },
  {
    id: 'tpl_teaching_guidance',
    name: '教學輔導',
    description: '提供課程設計、差異化教學、班級經營與評量規劃等可立即實施的教學策略。',
    systemPrompt:
      '你是一位兼具理論與實務的教學輔導教師（Mentor Teacher），擅長課程設計、差異化教學、班級經營與學習評量。你能協助教師進行備課共備、教案撰寫、提問設計、形成性評量規劃，並針對不同程度與學習風格的學生提供因材施教的建議。在回應時請：1) 以學習目標為核心，運用 Bloom 分類或教學目標框架組織內容；2) 提供具體、可立即實施的教學策略與活動；3) 兼顧認知、情意與技能三個面向；4) 關注學生的學習動機、自信心與個別差異（含特殊教育與雙語學習需求）；5) 適時引用教育心理學或教學法（如鷹架、合作學習、專題式學習 PBL）的概念，並說明如何落地。',
    icon: '🎓',
    badge: '教學策略',
    gradient:
      'from-purple-500/20 to-fuchsia-500/5 hover:from-purple-500/30 hover:to-fuchsia-500/10 border-purple-500/20',
    borderGlow:
      'group-hover:border-purple-500/50 shadow-[0_4px_20px_-4px_rgba(168,85,247,0.15)] group-hover:shadow-[0_4px_25px_0px_rgba(168,85,247,0.25)]',
    badgeColor: 'bg-purple-500/20 text-purple-300 border border-purple-500/30',
  },
  {
    id: 'tpl_admin_work',
    name: '行政作業',
    description: '撰寫公文簽呈、會議記錄、活動計畫書、成果報告與對外書信等行政文書。',
    systemPrompt:
      '你是一位熟悉學校行政與公文寫作的行政助理專家。你擅長撰寫各類行政文書，包括：公文與簽呈、會議記錄與議程、活動計畫書與企劃案、經費預算說明、成果報告、家長通知與公開公告、電子郵件回覆等。在回應時請：1) 採用正式、簡潔、條理分明的語氣，符合公文格式與慣用語；2) 結構化呈現（背景、目的、執行內容、時程、預算、預期效益）；3) 提供可填寫的範本或表格框架，並標註需要替換的關鍵欄位；4) 注意用語的禮節與分寸，特別是對外的正式書信；5) 以繁體中文撰寫，必要時輔以英文版本供雙語行政需求。',
    icon: '📋',
    badge: '行政文書',
    gradient:
      'from-emerald-500/20 to-teal-500/5 hover:from-emerald-500/30 hover:to-teal-500/10 border-emerald-500/20',
    borderGlow:
      'group-hover:border-emerald-500/50 shadow-[0_4px_20px_-4px_rgba(16,185,129,0.15)] group-hover:shadow-[0_4px_25px_0px_rgba(16,185,129,0.25)]',
    badgeColor: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
  },
  {
    id: 'tpl_html_dev_agent',
    name: 'HTML 開發代理',
    description:
      '兼具 PM 專案管理能力的 HTML 開發代理人，運用 Agent Harness 概念協調本平台的專案工具、待辦追蹤與平行子代理，帶你從需求到驗收完成 HTML 工具開發。',
    systemPrompt:
      '你是一位資深的 HTML 開發代理人（HTML Development Agent），同時具備專業的專案經理（PM）能力，精通 HTML5、CSS3 與現代 JavaScript，擅長開發單頁式互動工具、教學小遊戲與資料視覺化頁面。你在本平台的「HTML 專案模式」中運作，並以最新的 Agent Harness（代理運行框架）概念工作：將每次任務視為「規劃 → 授權工具 → 執行 → 驗證 → 回報」的迴圈，善用平台提供的專案工具、待辦追蹤與平行子代理完成開發。工作流程請遵循：1) 【PM 需求釐清】接到需求先確認目標使用者、核心功能、成功標準與範圍邊界；需求模糊時主動提出選項讓使用者決定，不要臆測。2) 【任務拆解與追蹤】以 setProjectTodos 將工作拆解為可驗收的待辦項目（每項附驗收標準），過程中用 updateProjectTodo 回報進度、checkProjectTodos 確認完成狀態，讓使用者隨時掌握專案全貌。3) 【Harness 化執行】依任務性質選擇正確的工具包：建立專案用 createProject，盤點與閱讀用 listFiles/readFile/searchFiles/getProjectSummary，修改用 writeFiles/replaceInFile/modifyLinesInFile，並保持小步提交、每步可回退。4) 【平行委派】當工作可自然分解為多條獨立調查或子任務時，使用 delegateToSubagents 委派 1–4 個子代理平行執行：每個子任務給予明確的名稱、自足的系統提示與具體指令，只授權必要的 htmlPacks（inspect／edit／todo_finalize／preview_recheck，bootstrap 禁止委派），且每批最多一個可寫入任務，其餘保持唯讀，最後統整子代理結果回報。5) 【驗證與品質】每個階段完成後用 renderPreview 呈現成果、getPreviewRuntimeErrors 檢查執行期錯誤、lintProject 檢查程式品質；發現問題先修復再繼續。6) 【風險管理】重大改動前留意 listSnapshots 快照，必要時以 revertToSnapshot 回退，絕不讓專案停留在壞掉的狀態。7) 【溝通】以繁體中文溝通，程式碼註解與變數命名使用英文；每輪結尾簡要回報「已完成／進行中／下一步」，像稱職的 PM 一樣讓使用者永遠知道專案進度。',
    icon: '🤖',
    badge: '開發代理',
    gradient:
      'from-rose-500/20 to-pink-500/5 hover:from-rose-500/30 hover:to-pink-500/10 border-rose-500/20',
    borderGlow:
      'group-hover:border-rose-500/50 shadow-[0_4px_20px_-4px_rgba(244,63,94,0.15)] group-hover:shadow-[0_4px_25px_0px_rgba(244,63,94,0.25)]',
    badgeColor: 'bg-rose-500/20 text-rose-300 border border-rose-500/30',
  },
  {
    id: 'tpl_computer_skills',
    name: '電腦操作',
    description: '指導辦公軟體、雲端協作與教育科技工具操作，提供循序漸進的步驟教學。',
    systemPrompt:
      '你是一位親切有耐心的資訊科技教學與數位操作指導員，擅長協助教師與學生掌握各類電腦操作、數位工具與教育科技軟體。你能撰寫清楚的圖文步驟教學、比較不同軟體的優缺點、解決常見的操作問題與疑難雜症，並指導辦公室套裝軟體（Word、Excel、PowerPoint、Google Workspace）、雲端協作、AI 工具與基礎網路安全。在回應時請：1) 使用循序漸進、清楚編號的步驟說明（一個動作一步）；2) 附上功能所在的選單路徑與快捷鍵；3) 預先提醒常見的錯誤操作與排除方法；4) 針對不同程度的使用者（初學者／進階）調整說明深度；5) 以繁體中文說明，軟體介面名稱使用官方繁體中文譯名。',
    icon: '💻',
    badge: '資訊應用',
    gradient:
      'from-cyan-500/20 to-sky-500/5 hover:from-cyan-500/30 hover:to-sky-500/10 border-cyan-500/20',
    borderGlow:
      'group-hover:border-cyan-500/50 shadow-[0_4px_20px_-4px_rgba(6,182,212,0.15)] group-hover:shadow-[0_4px_25px_0px_rgba(6,182,212,0.25)]',
    badgeColor: 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30',
  },
];

interface TemplateSelectorProps {
  onSelectTemplate: (template: AssistantTemplate) => void;
}

export const TemplateSelector: React.FC<TemplateSelectorProps> = ({ onSelectTemplate }) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const activeTemplate = ASSISTANT_TEMPLATES.find(t => t.id === selectedId);

  return (
    <div className='mb-8 bg-gray-900/40 backdrop-blur-md border border-gray-700/40 rounded-2xl p-6 shadow-xl'>
      <div className='flex items-center justify-between mb-4'>
        <div>
          <h3 className='text-lg font-bold text-white flex items-center gap-2'>
            <span>💡 選擇預設助理樣板</span>
            <span className='px-2 py-0.5 text-xs font-normal text-cyan-400 bg-cyan-950/50 border border-cyan-800/40 rounded-full'>
              推薦
            </span>
          </h3>
          <p className='text-xs text-gray-400 mt-1'>
            一鍵載入專業的角色設定，省去手動撰寫系統提示詞的繁瑣步驟。
          </p>
        </div>
      </div>

      {/* Grid Layout */}
      <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6'>
        {ASSISTANT_TEMPLATES.map(template => {
          const isSelected = selectedId === template.id;
          return (
            <button
              key={template.id}
              onClick={() => setSelectedId(template.id)}
              className={`group relative text-left flex flex-col justify-between p-5 rounded-xl border-2 bg-gradient-to-br ${template.gradient} ${template.borderGlow} transition-all duration-300 cursor-pointer transform hover:-translate-y-1 ${
                isSelected
                  ? 'border-cyan-500 bg-gray-800/80 scale-[1.01]'
                  : 'border-gray-700/40 bg-gray-800/40 hover:border-gray-600/50'
              }`}
            >
              <div>
                <div className='flex items-center justify-between mb-3'>
                  <span className='text-3xl filter drop-shadow-md transform group-hover:scale-110 transition-transform duration-200'>
                    {template.icon}
                  </span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-md font-semibold tracking-wider ${template.badgeColor}`}
                  >
                    {template.badge}
                  </span>
                </div>
                <h4 className='text-sm font-bold text-white mb-1 group-hover:text-cyan-300 transition-colors duration-200'>
                  {template.name}
                </h4>
                <p className='text-xs text-gray-400 line-clamp-3 leading-relaxed'>
                  {template.description}
                </p>
              </div>
              <div className='mt-4 flex items-center justify-end'>
                <span
                  className={`text-xs font-semibold px-3 py-1 rounded-lg transition-all duration-200 ${
                    isSelected
                      ? 'bg-cyan-500 text-white'
                      : 'bg-gray-700/60 text-gray-300 group-hover:bg-gray-700 group-hover:text-white'
                  }`}
                >
                  {isSelected ? '已選取' : '檢視樣板'}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Preview Section */}
      {activeTemplate && (
        <div className='bg-gray-950/60 border border-gray-800/80 rounded-xl p-5 animate-fadeIn transition-all duration-300'>
          <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-3 pb-3 border-b border-gray-800/60'>
            <div>
              <span className='text-xs text-gray-500 uppercase font-bold tracking-wider'>
                樣板預覽
              </span>
              <h4 className='text-base font-bold text-cyan-400 flex items-center gap-1.5 mt-0.5'>
                <span>{activeTemplate.icon}</span>
                <span>{activeTemplate.name}</span>
              </h4>
            </div>
            <button
              onClick={() => onSelectTemplate(activeTemplate)}
              className='px-5 py-2 bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 text-white text-xs font-bold rounded-lg transition-all duration-200 transform hover:scale-[1.02] shadow-md shadow-cyan-950/40 cursor-pointer'
            >
              ⚡ 套用此樣板
            </button>
          </div>
          <div className='space-y-3'>
            <div>
              <span className='block text-xs font-semibold text-gray-400 mb-1'>
                系統提示詞 (System Prompt)
              </span>
              <div className='bg-gray-900/80 rounded-lg p-3 text-xs text-gray-300 font-mono leading-relaxed max-h-36 overflow-y-auto whitespace-pre-wrap select-all border border-gray-850'>
                {activeTemplate.systemPrompt}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
