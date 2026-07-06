import { describe, it, expect } from 'vitest';
import {
  countConversationRounds,
  getLastNRounds,
  groupMessagesByRounds,
  getIncompleteRound,
  reconstructHistory,
  serializeAgentTurnLog,
  MAX_AGENT_TURN_LOG_CHARS,
  isSyntheticMessage,
  partitionSyntheticMessages,
  dropSyntheticForCompaction,
  buildSyntheticMessage,
  isErrorMessage,
} from './conversationUtils';
import { ChatMessage, ConversationRound } from '../types';

describe('conversationUtils', () => {
  const createMessage = (role: 'user' | 'model', content: string): ChatMessage => ({
    role,
    content,
  });

  describe('countConversationRounds', () => {
    it('should return 0 for empty array', () => {
      expect(countConversationRounds([])).toBe(0);
    });

    it('should count complete rounds correctly', () => {
      const messages = [
        createMessage('user', 'Hello'),
        createMessage('model', 'Hi there!'),
        createMessage('user', 'How are you?'),
        createMessage('model', 'I am fine!'),
      ];
      expect(countConversationRounds(messages)).toBe(2);
    });

    it('should not count incomplete rounds', () => {
      const messages = [
        createMessage('user', 'Hello'),
        createMessage('model', 'Hi there!'),
        createMessage('user', 'How are you?'), // 沒有AI回覆
      ];
      expect(countConversationRounds(messages)).toBe(1);
    });

    it('should handle single user message', () => {
      const messages = [createMessage('user', 'Hello')];
      expect(countConversationRounds(messages)).toBe(0);
    });

    it('should handle single model message', () => {
      const messages = [createMessage('model', 'Hi there!')];
      expect(countConversationRounds(messages)).toBe(0);
    });

    it('should handle consecutive user messages', () => {
      const messages = [
        createMessage('user', 'Hello'),
        createMessage('user', 'Are you there?'),
        createMessage('model', 'Yes, I am here!'),
      ];
      expect(countConversationRounds(messages)).toBe(1);
    });

    it('should handle consecutive model messages', () => {
      const messages = [
        createMessage('user', 'Hello'),
        createMessage('model', 'Hi!'),
        createMessage('model', 'How can I help?'),
        createMessage('user', 'Thanks'),
        createMessage('model', 'You are welcome!'),
      ];
      expect(countConversationRounds(messages)).toBe(2);
    });

    it('should not count isError messages as completed rounds', () => {
      const messages = [
        createMessage('user', 'Question 1'),
        { role: 'model' as const, content: 'Error bubble', isError: true },
        createMessage('user', 'Question 2'),
        createMessage('model', 'Answer 2'),
      ];

      expect(countConversationRounds(messages)).toBe(1);
    });
  });

  describe('getLastNRounds', () => {
    const messages = [
      createMessage('user', 'Hello'),
      createMessage('model', 'Hi!'),
      createMessage('user', 'How are you?'),
      createMessage('model', 'Good!'),
      createMessage('user', 'Nice weather'),
      createMessage('model', 'Indeed!'),
    ];

    it('should return empty array for rounds <= 0', () => {
      expect(getLastNRounds(messages, 0)).toEqual([]);
      expect(getLastNRounds(messages, -1)).toEqual([]);
    });

    it('should return empty array for empty messages', () => {
      expect(getLastNRounds([], 2)).toEqual([]);
    });

    it('should return last N rounds correctly', () => {
      const result = getLastNRounds(messages, 1);
      expect(result).toEqual([
        createMessage('user', 'Nice weather'),
        createMessage('model', 'Indeed!'),
      ]);
    });

    it('should return all rounds if N is larger than available', () => {
      const result = getLastNRounds(messages, 10);
      expect(result).toEqual(messages);
    });

    it('should return last 2 rounds correctly', () => {
      const result = getLastNRounds(messages, 2);
      expect(result).toEqual([
        createMessage('user', 'How are you?'),
        createMessage('model', 'Good!'),
        createMessage('user', 'Nice weather'),
        createMessage('model', 'Indeed!'),
      ]);
    });

    it('should skip isError responses when returning recent rounds', () => {
      const messagesWithError = [
        createMessage('user', 'Question 1'),
        { role: 'model' as const, content: 'Error bubble', isError: true },
        createMessage('user', 'Question 2'),
        createMessage('model', 'Answer 2'),
      ];

      expect(getLastNRounds(messagesWithError, 1)).toEqual([
        createMessage('user', 'Question 2'),
        createMessage('model', 'Answer 2'),
      ]);
    });
  });

  describe('groupMessagesByRounds', () => {
    it('should return empty array for empty input', () => {
      expect(groupMessagesByRounds([])).toEqual([]);
    });

    it('should group complete rounds correctly', () => {
      const messages = [
        createMessage('user', 'Hello'),
        createMessage('model', 'Hi!'),
        createMessage('user', 'Bye'),
        createMessage('model', 'Goodbye!'),
      ];

      const result = groupMessagesByRounds(messages);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        userMessage: createMessage('user', 'Hello'),
        assistantMessage: createMessage('model', 'Hi!'),
        roundNumber: 1,
      });
      expect(result[1]).toEqual({
        userMessage: createMessage('user', 'Bye'),
        assistantMessage: createMessage('model', 'Goodbye!'),
        roundNumber: 2,
      });
    });

    it('should ignore incomplete rounds', () => {
      const messages = [
        createMessage('user', 'Hello'),
        createMessage('model', 'Hi!'),
        createMessage('user', 'How are you?'), // 沒有AI回覆
      ];

      const result = groupMessagesByRounds(messages);
      expect(result).toHaveLength(1);
      expect(result[0].userMessage.content).toBe('Hello');
    });

    it('should handle consecutive user messages', () => {
      const messages = [
        createMessage('user', 'Hello'),
        createMessage('user', 'Are you there?'), // 第二個user訊息會被跳過
        createMessage('model', 'Yes!'),
      ];

      const result = groupMessagesByRounds(messages);
      expect(result).toHaveLength(1);
      expect(result[0].userMessage.content).toBe('Hello');
      expect(result[0].assistantMessage.content).toBe('Yes!');
    });

    it('should skip isError model messages when grouping rounds', () => {
      const messages = [
        createMessage('user', 'Question 1'),
        { role: 'model' as const, content: 'Error bubble', isError: true },
        createMessage('user', 'Question 2'),
        createMessage('model', 'Answer 2'),
      ];

      const result = groupMessagesByRounds(messages);
      expect(result).toEqual([
        {
          userMessage: createMessage('user', 'Question 2'),
          assistantMessage: createMessage('model', 'Answer 2'),
          roundNumber: 1,
        },
      ]);
    });
  });

  describe('getIncompleteRound', () => {
    it('should return null for empty array', () => {
      expect(getIncompleteRound([])).toBeNull();
    });

    it('should return null for complete conversation', () => {
      const messages = [createMessage('user', 'Hello'), createMessage('model', 'Hi!')];
      expect(getIncompleteRound(messages)).toBeNull();
    });

    it('should return incomplete user message', () => {
      const messages = [
        createMessage('user', 'Hello'),
        createMessage('model', 'Hi!'),
        createMessage('user', 'How are you?'),
      ];

      const result = getIncompleteRound(messages);
      expect(result).toEqual(createMessage('user', 'How are you?'));
    });

    it('should return null if last message is from model', () => {
      const messages = [createMessage('user', 'Hello'), createMessage('model', 'Hi there!')];
      expect(getIncompleteRound(messages)).toBeNull();
    });
  });

  describe('reconstructHistory', () => {
    const rounds: ConversationRound[] = [
      {
        userMessage: createMessage('user', 'Hello'),
        assistantMessage: createMessage('model', 'Hi!'),
        roundNumber: 1,
      },
      {
        userMessage: createMessage('user', 'Bye'),
        assistantMessage: createMessage('model', 'Goodbye!'),
        roundNumber: 2,
      },
    ];

    it('should reconstruct history with only recent rounds', () => {
      const result = reconstructHistory(null, rounds);

      expect(result).toEqual([
        createMessage('user', 'Hello'),
        createMessage('model', 'Hi!'),
        createMessage('user', 'Bye'),
        createMessage('model', 'Goodbye!'),
      ]);
    });

    it('should include compact context', () => {
      const compactContext = 'Previous conversation summary...';
      const result = reconstructHistory(compactContext, rounds);

      expect(result[0]).toEqual({
        role: 'system',
        content: '[COMPRESSED_CONTEXT] Previous conversation summary...',
      });
      expect(result).toHaveLength(5); // 1 system + 4 regular messages
    });

    it('should include incomplete message', () => {
      const incompleteMessage = createMessage('user', 'How are you?');
      const result = reconstructHistory(null, rounds, incompleteMessage);

      expect(result).toHaveLength(5);
      expect(result[4]).toEqual(incompleteMessage);
    });

    it('should handle all components together', () => {
      const compactContext = 'Summary...';
      const incompleteMessage = createMessage('user', 'New question');
      const result = reconstructHistory(compactContext, rounds, incompleteMessage);

      expect(result).toHaveLength(6);
      expect(result[0].role).toBe('system');
      expect(result[5]).toEqual(incompleteMessage);
    });

    it('should handle empty rounds', () => {
      const result = reconstructHistory('Summary...', []);

      expect(result).toEqual([
        {
          role: 'system',
          content: '[COMPRESSED_CONTEXT] Summary...',
        },
      ]);
    });
  });

  describe('serializeAgentTurnLog', () => {
    it('exports the 200-char constant', () => {
      expect(MAX_AGENT_TURN_LOG_CHARS).toBe(200);
    });

    it('returns input unchanged when within the limit', () => {
      const input = 'Loaded project, wrote index.html, ran preview.';
      expect(serializeAgentTurnLog(input)).toBe(input);
    });

    it('normalizes newlines (CRLF and LF) to single spaces', () => {
      const input = 'Line one.\nLine two.\r\nLine three.';
      expect(serializeAgentTurnLog(input)).toBe('Line one. Line two. Line three.');
    });

    it('trims surrounding whitespace after normalization', () => {
      expect(serializeAgentTurnLog('   hello world   ')).toBe('hello world');
    });

    it('truncates with ellipsis when exceeding the limit, total length <= MAX_AGENT_TURN_LOG_CHARS', () => {
      const input = 'a'.repeat(MAX_AGENT_TURN_LOG_CHARS + 50);
      const result = serializeAgentTurnLog(input);
      expect(result.length).toBeLessThanOrEqual(MAX_AGENT_TURN_LOG_CHARS);
      expect(result.endsWith('…')).toBe(true);
      // The body should be (MAX_AGENT_TURN_LOG_CHARS - 3) 'a' chars followed by '…'
      expect(result.slice(0, -1)).toBe('a'.repeat(MAX_AGENT_TURN_LOG_CHARS - 3));
    });

    it('does not truncate when exactly at the limit', () => {
      const input = 'b'.repeat(MAX_AGENT_TURN_LOG_CHARS);
      expect(serializeAgentTurnLog(input)).toBe(input);
    });

    it('normalizes newlines before measuring length', () => {
      // 199 newlines + 1 char = 200 chars; after normalization each newline becomes a space
      const input = `${'c'.repeat(199)}\n${'d'.repeat(50)}`;
      const result = serializeAgentTurnLog(input);
      expect(result.length).toBeLessThanOrEqual(MAX_AGENT_TURN_LOG_CHARS);
      expect(result.endsWith('…')).toBe(true);
    });
  });

  describe('isSyntheticMessage', () => {
    it('returns true only when synthetic === true', () => {
      expect(isSyntheticMessage({ role: 'user', content: 'x', synthetic: true })).toBe(true);
      expect(isSyntheticMessage({ role: 'user', content: 'x', synthetic: false })).toBe(false);
      expect(isSyntheticMessage({ role: 'user', content: 'x' })).toBe(false);
    });
  });

  describe('isErrorMessage', () => {
    it('returns true only when isError === true', () => {
      expect(isErrorMessage({ role: 'model', content: 'x', isError: true })).toBe(true);
      expect(isErrorMessage({ role: 'model', content: 'x', isError: false })).toBe(false);
      expect(isErrorMessage({ role: 'model', content: 'x' })).toBe(false);
    });
  });

  describe('partitionSyntheticMessages', () => {
    it('partitions by synthetic flag while preserving order', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'real-1' },
        { role: 'model', content: 'synthetic-1', synthetic: true },
        { role: 'user', content: 'real-2' },
        { role: 'model', content: 'synthetic-2', synthetic: true },
      ];

      const result = partitionSyntheticMessages(messages);
      expect(result.synthetic).toEqual([
        { role: 'model', content: 'synthetic-1', synthetic: true },
        { role: 'model', content: 'synthetic-2', synthetic: true },
      ]);
      expect(result.real).toEqual([
        { role: 'user', content: 'real-1' },
        { role: 'user', content: 'real-2' },
      ]);
    });

    it('excludes isError messages from the real partition', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'real-1' },
        { role: 'model', content: 'error-row', isError: true },
        { role: 'model', content: 'synthetic-1', synthetic: true },
      ];

      const result = partitionSyntheticMessages(messages);
      expect(result.synthetic).toEqual([
        { role: 'model', content: 'synthetic-1', synthetic: true },
      ]);
      expect(result.real).toEqual([{ role: 'user', content: 'real-1' }]);
    });

    it('returns empty synthetic when none are synthetic', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'a' },
        { role: 'model', content: 'b' },
      ];
      const result = partitionSyntheticMessages(messages);
      expect(result.synthetic).toEqual([]);
      expect(result.real).toEqual(messages);
    });

    it('returns empty real when all are synthetic', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'a', synthetic: true },
        { role: 'model', content: 'b', synthetic: true },
      ];
      const result = partitionSyntheticMessages(messages);
      expect(result.synthetic).toEqual(messages);
      expect(result.real).toEqual([]);
    });

    it('drops isError messages from the real partition without treating them as synthetic', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'a' },
        { role: 'model', content: 'err', isError: true },
        { role: 'model', content: 'b', synthetic: true },
      ];
      const result = partitionSyntheticMessages(messages);
      expect(result.synthetic).toEqual([{ role: 'model', content: 'b', synthetic: true }]);
      expect(result.real).toEqual([{ role: 'user', content: 'a' }]);
    });

    it('handles empty input', () => {
      const result = partitionSyntheticMessages([]);
      expect(result.synthetic).toEqual([]);
      expect(result.real).toEqual([]);
    });
  });

  describe('dropSyntheticForCompaction', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'real-A' },
      { role: 'model', content: 'synthetic-1', synthetic: true },
      { role: 'user', content: 'real-B' },
      { role: 'model', content: 'synthetic-2', synthetic: true },
      { role: 'user', content: 'real-C' },
    ];

    it('returns a shallow copy unchanged when dropCount <= 0', () => {
      const result = dropSyntheticForCompaction(messages, 0);
      expect(result).toEqual(messages);
      expect(result).not.toBe(messages); // a copy, not the same reference
    });

    it('drops only synthetic messages first (oldest first)', () => {
      const result = dropSyntheticForCompaction(messages, 1);
      expect(result).toEqual([
        { role: 'user', content: 'real-A' },
        { role: 'user', content: 'real-B' },
        { role: 'model', content: 'synthetic-2', synthetic: true },
        { role: 'user', content: 'real-C' },
      ]);
    });

    it('drops all synthetic messages before any real ones when dropCount >= synthetic count', () => {
      const result = dropSyntheticForCompaction(messages, 2);
      expect(result).toEqual([
        { role: 'user', content: 'real-A' },
        { role: 'user', content: 'real-B' },
        { role: 'user', content: 'real-C' },
      ]);
    });

    it('falls back to dropping real messages (oldest first) after synthetics are exhausted', () => {
      const result = dropSyntheticForCompaction(messages, 3);
      expect(result).toEqual([
        { role: 'user', content: 'real-B' },
        { role: 'user', content: 'real-C' },
      ]);
    });

    it('respects dropCount and does not drop more than requested', () => {
      const result = dropSyntheticForCompaction(messages, 4);
      // 2 synthetic + 2 oldest real (real-A, real-B) dropped
      expect(result).toEqual([{ role: 'user', content: 'real-C' }]);
    });

    it('returns empty array when dropCount >= messages.length', () => {
      expect(dropSyntheticForCompaction(messages, messages.length)).toEqual([]);
      expect(dropSyntheticForCompaction(messages, messages.length + 10)).toEqual([]);
    });

    it('preserves original relative order of remaining messages', () => {
      const result = dropSyntheticForCompaction(messages, 1);
      const remainingContents = result.map(m => m.content);
      expect(remainingContents).toEqual(['real-A', 'real-B', 'synthetic-2', 'real-C']);
    });

    it('handles empty input', () => {
      expect(dropSyntheticForCompaction([], 5)).toEqual([]);
    });
  });

  describe('buildSyntheticMessage', () => {
    it('builds a synthetic user message with synthetic:true', () => {
      const msg = buildSyntheticMessage('user', 'Continuing previous turn');
      expect(msg.role).toBe('user');
      expect(msg.content).toBe('Continuing previous turn');
      expect(msg.synthetic).toBe(true);
      expect(msg.agentTurnLog).toBeUndefined();
    });

    it('builds a synthetic model message and serializes agentTurnLog', () => {
      const longLog = 'Loaded project.\nWrote /index.html.\nRan preview.'.repeat(20);
      const msg = buildSyntheticMessage('model', 'Synthetic assistant summary', longLog);
      expect(msg.role).toBe('model');
      expect(msg.synthetic).toBe(true);
      expect(msg.agentTurnLog).toBeDefined();
      expect(msg.agentTurnLog!.length).toBeLessThanOrEqual(MAX_AGENT_TURN_LOG_CHARS);
      expect(msg.agentTurnLog!.endsWith('…')).toBe(true);
    });

    it('leaves agentTurnLog undefined when not provided', () => {
      const msg = buildSyntheticMessage('user', 'no log');
      expect(msg.agentTurnLog).toBeUndefined();
    });

    it('serializes short agentTurnLog verbatim (after newline normalization)', () => {
      const msg = buildSyntheticMessage('model', 'ok', 'Line one.\nLine two.');
      expect(msg.agentTurnLog).toBe('Line one. Line two.');
    });
  });
});
