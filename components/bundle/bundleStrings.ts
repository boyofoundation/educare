/**
 * Central module for bundle-related user-facing strings.
 *
 * Bundle features keep their zh-TW copy here so the wording stays consistent
 * across the import page, builder wizard, and sandbox, and so a future i18n
 * pass has a single extraction point. Keep new bundle strings here rather
 * than inlining them.
 */

export const bundleStrings = {
  import: {
    title: '匯入協作包',
    subtitle: '載入他人分享的 Agent 協作包 JSON，於本地瀏覽器獨立沙盒中對話。資料不會上傳伺服器。',
    back: '返回',
    dropHint: '將協作包 JSON 檔案拖放至此',
    chooseFile: '選擇檔案',
    pasteLabel: '或貼上 JSON 文字',
    parseButton: '解析貼上內容',
    activate: '啟用協作包',
    importing: '匯入中...',
    importedListTitle: '已匯入的協作包',
    empty: '尚未匯入任何協作包。',
    open: '開啟',
    delete: '刪除',
    confirmDelete: '將一併刪除對話紀錄，確定？',
    confirmDeleteConfirm: '確定刪除',
    cancel: '取消',
  },
  builder: {
    title: '打包協作包',
    subtitle: '選取多個助理、設定接待入口與路由，匯出為單一 JSON 協作包。',
    receptionistTitle: '接待入口（單選）',
    receptionistLabel: (name: string) => `設為接待入口：${name}`,
    matrixTitle: '路由矩陣',
    mathToolsLabel: '啟用數學計算與幾何繪圖工具',
    mathToolsHelp: '需支援工具呼叫的模型；Ollama 目前不支援。',
    next: '下一步',
    prev: '上一步',
    export: '匯出 JSON',
    preview: '預覽',
  },
  sandbox: {
    clearConversation: '清除對話',
    bundleDetails: '包內容',
    reExport: '重新匯出',
    backToWizard: '返回精靈',
    sessionList: '對話紀錄',
    newSession: '新增對話',
    resumeSession: (title: string) => `續聊：${title}`,
    deleteSession: '刪除對話',
    confirmDeleteSession: '確定要刪除這段對話嗎？',
  },
  editor: {
    title: '編輯協作包',
    subtitle: '修改後儲存在此瀏覽器，不會改動原始匯入檔案。',
    settings: '協作包設定',
    name: '協作包名稱',
    version: '版本',
    entryAgent: '接待入口',
    entryAgentLabel: '接待入口助理',
    description: '協作包描述',
    agents: '包內助理',
    entryBadge: '入口',
    routeConditions: '路由條件',
    noRoutes: '目前沒有設定中的路由。',
    routeConditionPlaceholder: '觸發條件（選填）',
    save: '儲存協作包',
    saving: '儲存中...',
    nameRequired: '協作包名稱為必填。',
    saveFailed: '儲存協作包失敗，請稍後再試。',
    storageFull: '瀏覽器儲存空間不足，請刪除不需要的協作包或對話紀錄後重試。',
  },
  transitions: {
    auto: '已自動轉接至',
    manual: '建議轉接',
    accepted: '已轉接',
    declined: '已拒絕',
    failed: '轉接失敗',
  },
  errors: {
    key401: 'AI 金鑰無效或已過期。請重新設定金鑰後再試。',
    key429: '目前用量已達上限。請稍候再試。',
    network: '網路連線發生問題。請確認網路後重試。',
    generic: '傳送時發生問題。請檢查您的 AI 金鑰與網路連線。',
    retry: '重試',
    openKeySettings: '設定 AI 金鑰',
  },
} as const;
