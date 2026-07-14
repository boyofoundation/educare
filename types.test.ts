import { describe, it, expect } from 'vitest';
import {
  ChatMessage,
  CompactContext,
  ConversationRound,
  ChatSession,
  Assistant,
  RagChunk,
} from './types';

describe('Type Definitions', () => {
  describe('ChatMessage', () => {
    it('should accept valid user message', () => {
      const userMessage: ChatMessage = {
        role: 'user',
        content: 'Hello world',
      };

      expect(userMessage.role).toBe('user');
      expect(userMessage.content).toBe('Hello world');
    });

    it('should accept valid model message', () => {
      const modelMessage: ChatMessage = {
        role: 'model',
        content: 'Hi there!',
      };

      expect(modelMessage.role).toBe('model');
      expect(modelMessage.content).toBe('Hi there!');
    });
  });

  describe('CompactContext', () => {
    it('should accept valid compact context', () => {
      const compactContext: CompactContext = {
        type: 'compact',
        content: 'This is a compressed summary of previous conversations...',
        tokenCount: 1500,
        compressedFromRounds: 8,
        compressedFromMessages: 16,
        createdAt: '2025-09-10T12:00:00Z',
        version: '1.0',
      };

      expect(compactContext.type).toBe('compact');
      expect(compactContext.tokenCount).toBe(1500);
      expect(compactContext.compressedFromRounds).toBe(8);
      expect(compactContext.compressedFromMessages).toBe(16);
    });

    it('should enforce type literal', () => {
      // This should compile
      const validContext: CompactContext = {
        type: 'compact',
        content: 'Summary',
        tokenCount: 100,
        compressedFromRounds: 2,
        compressedFromMessages: 4,
        createdAt: '2025-09-10T12:00:00Z',
        version: '1.0',
      };

      expect(validContext.type).toBe('compact');
    });
  });

  describe('ConversationRound', () => {
    it('should accept valid conversation round', () => {
      const userMessage: ChatMessage = {
        role: 'user',
        content: 'How are you?',
      };

      const assistantMessage: ChatMessage = {
        role: 'model',
        content: 'I am doing well, thank you!',
      };

      const round: ConversationRound = {
        userMessage,
        assistantMessage,
        roundNumber: 1,
      };

      expect(round.roundNumber).toBe(1);
      expect(round.userMessage.role).toBe('user');
      expect(round.assistantMessage.role).toBe('model');
    });
  });

  describe('ChatSession with compression support', () => {
    it('should accept session without compression', () => {
      const session: ChatSession = {
        id: 'session-1',
        assistantId: 'assistant-1',
        title: 'Test Session',
        messages: [],
        createdAt: Date.now(),
        tokenCount: 0,
      };

      expect(session.compactContext).toBeUndefined();
      expect(session.lastCompactionAt).toBeUndefined();
    });

    it('should accept session with compression context', () => {
      const compactContext: CompactContext = {
        type: 'compact',
        content: 'Compressed conversation summary',
        tokenCount: 2000,
        compressedFromRounds: 10,
        compressedFromMessages: 20,
        createdAt: '2025-09-10T12:00:00Z',
        version: '1.0',
      };

      const session: ChatSession = {
        id: 'session-1',
        assistantId: 'assistant-1',
        title: 'Test Session with Compression',
        messages: [
          { role: 'user', content: 'Recent user message' },
          { role: 'model', content: 'Recent assistant response' },
        ],
        createdAt: Date.now(),
        tokenCount: 150,
        compactContext,
        lastCompactionAt: '2025-09-10T12:00:00Z',
      };

      expect(session.compactContext).toBeDefined();
      expect(session.compactContext?.type).toBe('compact');
      expect(session.compactContext?.tokenCount).toBe(2000);
      expect(session.lastCompactionAt).toBe('2025-09-10T12:00:00Z');
    });

    it('should accept session with only lastCompactionAt', () => {
      const session: ChatSession = {
        id: 'session-1',
        assistantId: 'assistant-1',
        title: 'Test Session',
        messages: [],
        createdAt: Date.now(),
        tokenCount: 0,
        lastCompactionAt: '2025-09-10T10:00:00Z',
      };

      expect(session.compactContext).toBeUndefined();
      expect(session.lastCompactionAt).toBe('2025-09-10T10:00:00Z');
    });

    it('should accept session with optional activeProjectId for HTML canvas continuity', () => {
      const session: ChatSession = {
        id: 'session-1',
        assistantId: 'assistant-1',
        title: 'Project Session',
        messages: [],
        createdAt: Date.now(),
        tokenCount: 0,
        activeProjectId: 'project-123',
      };

      expect(session.activeProjectId).toBe('project-123');
    });
  });

  describe('Type compatibility', () => {
    it('should maintain backward compatibility for existing types', () => {
      // Test that existing Assistant interface still works
      const assistant: Assistant = {
        id: 'test-assistant',
        name: 'Test Assistant',
        description: 'A test assistant',
        systemPrompt: 'You are a helpful assistant',
        createdAt: Date.now(),
      };

      expect(assistant.id).toBe('test-assistant');

      // Test that RagChunk still works
      const ragChunk: RagChunk = {
        fileName: 'test.txt',
        content: 'Test content',
        vector: [0.1, 0.2, 0.3],
      };

      expect(ragChunk.fileName).toBe('test.txt');
    });

    it('should allow optional compression fields to be omitted', () => {
      // This should compile without issues
      const sessionWithoutCompression: ChatSession = {
        id: 'session-1',
        assistantId: 'assistant-1',
        title: 'No Compression Session',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'model', content: 'Hi!' },
        ],
        createdAt: Date.now(),
        tokenCount: 50,
        // compactContext and lastCompactionAt are optional
      };

      // Check that TypeScript doesn't require these fields
      expect(sessionWithoutCompression.compactContext).toBeUndefined();
      expect(sessionWithoutCompression.lastCompactionAt).toBeUndefined();
    });
  });

  describe('CompactContext versioning', () => {
    it('should support different versions for future upgrades', () => {
      const v1Context: CompactContext = {
        type: 'compact',
        content: 'V1 compressed content',
        tokenCount: 1000,
        compressedFromRounds: 5,
        compressedFromMessages: 10,
        createdAt: '2025-09-10T12:00:00Z',
        version: '1.0',
      };

      const v2Context: CompactContext = {
        type: 'compact',
        content: 'V2 compressed content with improvements',
        tokenCount: 800, // More efficient compression
        compressedFromRounds: 5,
        compressedFromMessages: 10,
        createdAt: '2025-09-10T13:00:00Z',
        version: '2.0',
      };

      expect(v1Context.version).toBe('1.0');
      expect(v2Context.version).toBe('2.0');
      expect(v2Context.tokenCount).toBeLessThan(v1Context.tokenCount);
    });
  });

  describe('Real-world usage scenarios', () => {
    it('should handle session evolution from no compression to compressed', () => {
      // Initial session without compression
      let session: ChatSession = {
        id: 'evolving-session',
        assistantId: 'assistant-1',
        title: 'Evolving Session',
        messages: [],
        createdAt: Date.now(),
        tokenCount: 0,
      };

      // Add some messages
      session.messages.push(
        { role: 'user', content: 'Message 1' },
        { role: 'model', content: 'Response 1' },
        { role: 'user', content: 'Message 2' },
        { role: 'model', content: 'Response 2' },
      );
      session.tokenCount = 200;

      expect(session.messages).toHaveLength(4);

      // Later, add compression
      const compactContext: CompactContext = {
        type: 'compact',
        content: 'Compressed previous conversations',
        tokenCount: 150,
        compressedFromRounds: 2,
        compressedFromMessages: 4,
        createdAt: '2025-09-10T14:00:00Z',
        version: '1.0',
      };

      session = {
        ...session,
        compactContext,
        lastCompactionAt: '2025-09-10T14:00:00Z',
        messages: [], // Reset to only recent messages
        tokenCount: 0,
      };

      expect(session.compactContext).toBeDefined();
      expect(session.compactContext?.compressedFromRounds).toBe(2);
      expect(session.messages).toHaveLength(0);
    });
  });
});
