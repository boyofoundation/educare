import { ChatMessage, ConversationRound } from '../types';

/**
 * Agent 回合摘要軌跡 (G6) 的最大字元數上限。
 * 序列化後保證長度 <= 此值,供活動面板顯示與持久化使用。
 */
export const MAX_AGENT_TURN_LOG_CHARS = 200;

/**
 * 序列化 agent 回合摘要軌跡 (G6)。
 *
 * - 將所有換行 (含 CRLF) 正規化為單一空格。
 * - 若長度超過 MAX_AGENT_TURN_LOG_CHARS,則截斷為 (MAX_AGENT_TURN_LOG_CHARS - 3) 字元 + '…',
 *   保證最終長度 <= MAX_AGENT_TURN_LOG_CHARS。
 *
 * @param input - 原始 agent 回合摘要文字
 * @returns 序列化後的摘要 (長度 <= MAX_AGENT_TURN_LOG_CHARS)
 */
export function serializeAgentTurnLog(input: string): string {
  const normalized = input.replace(/\r?\n+/g, ' ').trim();
  if (normalized.length <= MAX_AGENT_TURN_LOG_CHARS) {
    return normalized;
  }
  return normalized.slice(0, MAX_AGENT_TURN_LOG_CHARS - 3) + '…';
}

/**
 * 判斷訊息是否為合成訊息 (G6)。
 *
 * 合成訊息由 controller 在續跑回合產生,用於歷史銜接;在 compaction 時為最優先丟棄對象。
 *
 * @param message - 待檢測的訊息
 * @returns 若 `message.synthetic === true` 則回傳 true
 */
export function isSyntheticMessage(message: ChatMessage): boolean {
  return message.synthetic === true;
}

/**
 * 判斷訊息是否為不可回送到模型上下文的錯誤訊息。
 */
export function isErrorMessage(message: ChatMessage): boolean {
  return message.isError === true;
}

/**
 * 將訊息陣列依「合成 / 真實」分區 (G6)。
 *
 * @param messages - 聊天訊息陣列
 * @returns `{ synthetic, real }` 兩個陣列,各自維持原始出現順序
 */
export function partitionSyntheticMessages(messages: ChatMessage[]): {
  synthetic: ChatMessage[];
  real: ChatMessage[];
} {
  const synthetic: ChatMessage[] = [];
  const real: ChatMessage[] = [];
  for (const message of messages) {
    if (isSyntheticMessage(message)) {
      synthetic.push(message);
    } else if (!isErrorMessage(message)) {
      real.push(message);
    }
  }
  return { synthetic, real };
}

/**
 * 以「合成優先」策略丟棄訊息,供 compaction 使用 (G6)。
 *
 * 策略:
 *   1. 先丟棄 `synthetic:true` 的訊息 (最舊的先丟);
 *   2. 若仍需湊足 `dropCount`,才開始丟棄最舊的真實訊息;
 *   3. 回傳剩餘訊息,維持原始順序。
 *
 * @param messages - 原始訊息陣列
 * @param dropCount - 欲丟棄的訊息數上限 (實際丟棄數 <= min(dropCount, messages.length))
 * @returns 剩餘訊息陣列 (原始順序)
 */
export function dropSyntheticForCompaction(
  messages: ChatMessage[],
  dropCount: number,
): ChatMessage[] {
  if (dropCount <= 0 || messages.length === 0) {
    return [...messages];
  }

  const syntheticIndices: number[] = [];
  messages.forEach((message, index) => {
    if (isSyntheticMessage(message)) {
      syntheticIndices.push(index);
    }
  });

  const toDrop = new Set<number>();
  for (const index of syntheticIndices) {
    if (toDrop.size >= dropCount) {
      break;
    }
    toDrop.add(index);
  }

  if (toDrop.size < dropCount) {
    messages.forEach((message, index) => {
      if (toDrop.size >= dropCount) {
        return;
      }
      if (!isSyntheticMessage(message)) {
        toDrop.add(index);
      }
    });
  }

  return messages.filter((_, index) => !toDrop.has(index));
}

/**
 * 建構一條合成訊息 (G6),供 controller 於續跑回合拼接歷史時使用。
 *
 * @param role - 'user' 或 'model'
 * @param content - 訊息內容
 * @param agentTurnLog - 可選的 agent 回合摘要;會先經 serializeAgentTurnLog 序列化
 * @returns 標記為 `synthetic:true` 的 ChatMessage
 */
export function buildSyntheticMessage(
  role: 'user' | 'model',
  content: string,
  agentTurnLog?: string,
): ChatMessage {
  return {
    role,
    content,
    synthetic: true,
    agentTurnLog: agentTurnLog ? serializeAgentTurnLog(agentTurnLog) : undefined,
  };
}

/**
 * 計算訊息陣列中的完整對話輪次數
 *
 * @param messages - 聊天訊息陣列
 * @returns 完整對話輪次數 (只計算有配對的使用者-AI對話)
 *
 * @example
 * // 完整的對話: user -> model -> user -> model = 2輪
 * const messages = [
 *   { role: 'user', content: 'Hello' },
 *   { role: 'model', content: 'Hi there!' },
 *   { role: 'user', content: 'How are you?' },
 *   { role: 'model', content: 'I am fine!' }
 * ];
 * countConversationRounds(messages); // 返回 2
 */
export function countConversationRounds(messages: ChatMessage[]): number {
  if (messages.length === 0) {
    return 0;
  }

  let rounds = 0;
  let expectingUserMessage = true;

  for (const message of messages) {
    if (expectingUserMessage && message.role === 'user') {
      expectingUserMessage = false; // 下一個期待 model 回覆
      continue;
    }

    if (!expectingUserMessage && message.role === 'model') {
      if (!isErrorMessage(message)) {
        rounds++; // 完成一輪對話
      }
      expectingUserMessage = true; // 錯誤或成功都視為本輪結束，不跨輪配對
    }
    // 如果順序不對，保持當前狀態繼續尋找正確的配對
  }

  return rounds;
}

/**
 * 獲取最後 N 輪完整對話的訊息
 *
 * @param messages - 聊天訊息陣列
 * @param rounds - 要保留的輪次數
 * @returns 最後 N 輪對話的訊息陣列
 *
 * @example
 * // 保留最後 1 輪對話
 * const messages = [
 *   { role: 'user', content: 'Hello' },
 *   { role: 'model', content: 'Hi!' },
 *   { role: 'user', content: 'Bye' },
 *   { role: 'model', content: 'Goodbye!' }
 * ];
 * getLastNRounds(messages, 1);
 * // 返回: [{ role: 'user', content: 'Bye' }, { role: 'model', content: 'Goodbye!' }]
 */
export function getLastNRounds(messages: ChatMessage[], rounds: number): ChatMessage[] {
  if (rounds <= 0 || messages.length === 0) {
    return [];
  }

  const conversationRounds = groupMessagesByRounds(messages);
  const lastRounds = conversationRounds.slice(-rounds);

  const result: ChatMessage[] = [];
  for (const round of lastRounds) {
    result.push(round.userMessage, round.assistantMessage);
  }

  return result;
}

/**
 * 將訊息陣列按對話輪次分組
 *
 * @param messages - 聊天訊息陣列
 * @returns 對話輪次陣列，每個輪次包含配對的使用者和AI訊息
 *
 * @example
 * const messages = [
 *   { role: 'user', content: 'Hello' },
 *   { role: 'model', content: 'Hi!' },
 *   { role: 'user', content: 'How are you?' },
 *   { role: 'model', content: 'Good!' }
 * ];
 * groupMessagesByRounds(messages);
 * // 返回: [
 * //   { userMessage: {...'Hello'}, assistantMessage: {...'Hi!'}, roundNumber: 1 },
 * //   { userMessage: {...'How are you?'}, assistantMessage: {...'Good!'}, roundNumber: 2 }
 * // ]
 */
export function groupMessagesByRounds(messages: ChatMessage[]): ConversationRound[] {
  if (messages.length === 0) {
    return [];
  }

  const rounds: ConversationRound[] = [];
  let currentUserMessage: ChatMessage | null = null;
  let roundNumber = 1;

  for (const message of messages) {
    if (message.role === 'user') {
      // 如果已經有未配對的用戶訊息，跳過（處理連續的user訊息）
      if (currentUserMessage === null) {
        currentUserMessage = message;
      }
      continue;
    }

    if (message.role === 'model' && currentUserMessage !== null) {
      if (!isErrorMessage(message)) {
        // 找到配對的AI回覆，建立一輪對話
        rounds.push({
          userMessage: currentUserMessage,
          assistantMessage: message,
          roundNumber: roundNumber++,
        });
      }
      currentUserMessage = null;
    }
  }

  return rounds;
}

/**
 * 檢查訊息陣列是否包含未完成的對話
 * (最後一條訊息是使用者訊息但沒有AI回覆)
 *
 * @param messages - 聊天訊息陣列
 * @returns 如果有未完成的對話返回該使用者訊息，否則返回 null
 */
export function getIncompleteRound(messages: ChatMessage[]): ChatMessage | null {
  if (messages.length === 0) {
    return null;
  }

  const lastMessage = messages[messages.length - 1];

  // 如果最後一條是使用者訊息，檢查是否有對應的AI回覆
  if (lastMessage.role === 'user') {
    // 檢查是否這是一個未配對的使用者訊息
    const rounds = groupMessagesByRounds(messages);
    const totalPairedMessages = rounds.length * 2;

    if (messages.length > totalPairedMessages) {
      return lastMessage;
    }
  }

  return null;
}

/**
 * 系統訊息型別 (用於壓縮上下文)
 */
export interface SystemMessage {
  role: 'system';
  content: string;
}

/**
 * 重建訊息歷史，整合壓縮上下文和最近對話
 *
 * @param compactContext - 壓縮的對話摘要
 * @param recentRounds - 最近的完整對話輪次
 * @param incompleteMessage - 未完成的使用者訊息 (可選)
 * @returns 重建的訊息陣列
 */
export function reconstructHistory(
  compactContext: string | null,
  recentRounds: ConversationRound[],
  incompleteMessage?: ChatMessage,
): (ChatMessage | SystemMessage)[] {
  const messages: (ChatMessage | SystemMessage)[] = [];

  // 加入壓縮上下文 (如果存在)
  if (compactContext) {
    messages.push({
      role: 'system' as const,
      content: `[COMPRESSED_CONTEXT] ${compactContext}`,
    } as SystemMessage);
  }

  // 加入最近的完整對話
  for (const round of recentRounds) {
    messages.push(round.userMessage, round.assistantMessage);
  }

  // 加入未完成的使用者訊息 (如果存在)
  if (incompleteMessage) {
    messages.push(incompleteMessage);
  }

  return messages;
}
