import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ChatInput from '../ChatInput';
import { setupTestEnvironment } from './test-utils';

describe('ChatInput', () => {
  let testEnv: ReturnType<typeof setupTestEnvironment>;
  const mockProps = {
    value: '',
    onChange: vi.fn(),
    onSend: vi.fn(),
    isLoading: false,
    disabled: false,
  };

  beforeEach(() => {
    testEnv = setupTestEnvironment();
    vi.clearAllMocks();
  });

  afterEach(() => {
    testEnv.cleanup();
    Reflect.deleteProperty(window, 'SpeechRecognition');
    Reflect.deleteProperty(window, 'webkitSpeechRecognition');
  });

  describe('Input Field Rendering', () => {
    it('should render textarea with correct attributes', () => {
      // Arrange & Act
      render(<ChatInput {...mockProps} />);

      // Assert
      const textarea = screen.getByRole('textbox');
      expect(textarea).toBeInTheDocument();
      expect(textarea).toHaveAttribute('placeholder', '輸入您的訊息...');
      expect(textarea).toHaveAttribute('aria-label', '輸入訊息');
      expect(textarea).toHaveAttribute('aria-describedby', 'input-help');
      expect(textarea).toHaveAttribute('aria-multiline', 'true');
      expect(textarea).toHaveAttribute('role', 'textbox');
    });

    it('should display current value in textarea', () => {
      // Arrange
      const value = 'Test message content';

      // Act
      render(<ChatInput {...mockProps} value={value} />);

      // Assert
      expect(screen.getByDisplayValue(value)).toBeInTheDocument();
    });

    it('should apply correct styling classes', () => {
      // Arrange & Act
      render(<ChatInput {...mockProps} />);

      // Assert
      const textarea = screen.getByRole('textbox');
      expect(textarea).toHaveClass(
        'w-full',
        'bg-gray-700/60',
        'border-2',
        'border-gray-600/40',
        'rounded-2xl',
      );
    });

    it('should dynamically adjust height based on content', () => {
      // Arrange
      const multilineValue = 'Line 1\nLine 2\nLine 3';

      // Act
      render(<ChatInput {...mockProps} value={multilineValue} />);

      // Assert
      const textarea = screen.getByRole('textbox');
      const expectedHeight = Math.min(multilineValue.split('\n').length * 20 + 28, 120) + 'px';
      expect(textarea).toHaveStyle({ height: expectedHeight });
    });
  });

  describe('Send Button Rendering', () => {
    it('should render send button with correct attributes', () => {
      // Arrange & Act
      render(<ChatInput {...mockProps} />);

      // Assert
      const sendButton = screen.getByRole('button', { name: /傳送訊息/i });
      expect(sendButton).toBeInTheDocument();
      expect(sendButton).toHaveAttribute('type', 'submit');
      expect(sendButton).toHaveAttribute('aria-label', '傳送訊息');
    });

    it('should show loading state when isLoading is true', () => {
      // Arrange & Act
      render(<ChatInput {...mockProps} isLoading={true} />);

      // Assert
      const sendButton = screen.getByRole('button');
      expect(sendButton).toBeDisabled();
      expect(sendButton).toHaveAttribute('aria-label', '正在傳送訊息');

      // Check for loading spinner
      const spinner = sendButton.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
    });

    it('should disable send button when no text is entered', () => {
      // Arrange & Act
      render(<ChatInput {...mockProps} value='' />);

      // Assert
      const sendButton = screen.getByRole('button');
      expect(sendButton).toBeDisabled();
    });

    it('should disable send button with only whitespace', () => {
      // Arrange & Act
      render(<ChatInput {...mockProps} value={'   \n  \t  '} />);

      // Assert
      const sendButton = screen.getByRole('button');
      expect(sendButton).toBeDisabled();
    });

    it('should enable send button when there is valid text', () => {
      // Arrange & Act
      render(<ChatInput {...mockProps} value='Valid message' />);

      // Assert
      const sendButton = screen.getByRole('button');
      expect(sendButton).not.toBeDisabled();
    });

    it('should disable send button when disabled prop is true', () => {
      // Arrange & Act
      render(<ChatInput {...mockProps} value='Valid message' disabled={true} />);

      // Assert
      const sendButton = screen.getByRole('button');
      expect(sendButton).toBeDisabled();
    });
  });

  describe('Character Counter Display', () => {
    it('should show character counter for long messages', () => {
      // Arrange
      const longValue = 'a'.repeat(150);

      // Act
      render(<ChatInput {...mockProps} value={longValue} />);

      // Assert
      expect(screen.getByText('150')).toBeInTheDocument();
    });

    it('should not show character counter for short messages', () => {
      // Arrange
      const shortValue = 'short';

      // Act
      render(<ChatInput {...mockProps} value={shortValue} />);

      // Assert
      // Should not show character count for messages under 100 chars
      const charCounter = screen.queryByText('5');
      expect(charCounter).not.toBeInTheDocument();
    });
  });

  describe('Input Value Changes', () => {
    it('should call onChange when user types', () => {
      // Arrange
      render(<ChatInput {...mockProps} />);

      // Act - use fireEvent for controlled inputs to simulate value change
      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: 'Hello world' } });

      // Assert
      expect(mockProps.onChange).toHaveBeenCalledWith('Hello world');
    });

    it('should handle paste operations', () => {
      // Arrange
      render(<ChatInput {...mockProps} />);

      // Act - simulate paste via change event on controlled input
      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: 'Pasted content' } });

      // Assert
      expect(mockProps.onChange).toHaveBeenCalledWith('Pasted content');
    });

    it('should handle clear operations', () => {
      // Arrange
      render(<ChatInput {...mockProps} value='Some text' />);

      // Act - simulate clear via change event on controlled input
      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: '' } });

      // Assert
      expect(mockProps.onChange).toHaveBeenCalledWith('');
    });

    it('uses native speech recognition when the browser supports it', async () => {
      const recognitionInstances: Array<{
        onresult:
          | ((event: {
              results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
            }) => void)
          | null;
        onend: (() => void) | null;
        start: ReturnType<typeof vi.fn>;
        stop: ReturnType<typeof vi.fn>;
        abort: ReturnType<typeof vi.fn>;
      }> = [];

      class MockSpeechRecognition {
        lang = '';
        interimResults = false;
        continuous = false;
        onresult:
          | ((event: {
              results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
            }) => void)
          | null = null;
        onend: (() => void) | null = null;
        onerror: (() => void) | null = null;
        start = vi.fn();
        stop = vi.fn();
        abort = vi.fn();

        constructor() {
          recognitionInstances.push(this);
        }
      }

      Object.defineProperty(window, 'webkitSpeechRecognition', {
        value: MockSpeechRecognition,
        configurable: true,
      });

      render(<ChatInput {...mockProps} value='Say' />);

      const speechButton = await screen.findByRole('button', { name: '開始語音輸入' });
      fireEvent.click(speechButton);
      const recognitionInstance = recognitionInstances[0];
      recognitionInstance?.onresult?.({
        results: [{ isFinal: true, 0: { transcript: 'hello' } }],
      });

      expect(recognitionInstance?.start).toHaveBeenCalled();
      expect(mockProps.onChange).toHaveBeenCalledWith('Say hello');
    });
  });

  describe('Send Button Functionality', () => {
    it('should call onSend when send button is clicked', async () => {
      // Arrange
      const user = userEvent.setup();
      render(<ChatInput {...mockProps} value='Test message' />);

      // Act
      const sendButton = screen.getByRole('button');
      await user.click(sendButton);

      // Assert
      expect(mockProps.onSend).toHaveBeenCalledTimes(1);
    });

    it('should not call onSend when button is disabled', async () => {
      // Arrange
      const user = userEvent.setup();
      render(<ChatInput {...mockProps} value='' />); // Empty value disables button

      // Act
      const sendButton = screen.getByRole('button');
      await user.click(sendButton);

      // Assert
      expect(mockProps.onSend).not.toHaveBeenCalled();
    });
  });

  describe('Enter Key Handling', () => {
    it('should call onSend when Enter key is pressed without Shift', async () => {
      // Arrange
      const user = userEvent.setup();
      render(<ChatInput {...mockProps} value='Test message' />);

      // Act
      const textarea = screen.getByRole('textbox');
      await user.click(textarea);
      await user.keyboard('{Enter}');

      // Assert
      expect(mockProps.onSend).toHaveBeenCalledTimes(1);
    });

    it('should not call onSend when Shift+Enter is pressed', async () => {
      // Arrange
      const user = userEvent.setup();
      render(<ChatInput {...mockProps} value='Test message' />);

      // Act
      const textarea = screen.getByRole('textbox');
      await user.click(textarea);
      await user.keyboard('{Shift>}{Enter}{/Shift}');

      // Assert
      expect(mockProps.onSend).not.toHaveBeenCalled();
    });

    it('should not call onSend when composition is active', () => {
      // Arrange
      render(<ChatInput {...mockProps} value='Test message' />);

      // Act
      const textarea = screen.getByRole('textbox');

      // Simulate composition start (e.g., Chinese input)
      fireEvent.compositionStart(textarea);

      // Simulate Enter key during composition
      fireEvent.keyDown(textarea, {
        key: 'Enter',
        shiftKey: false,
        nativeEvent: { isComposing: true },
      });

      // Assert
      expect(mockProps.onSend).not.toHaveBeenCalled();
    });
  });

  describe('Composition Events for Chinese Input', () => {
    it('should handle composition start event', () => {
      // Arrange
      render(<ChatInput {...mockProps} value='Test' />);
      const textarea = screen.getByRole('textbox');

      // Act
      fireEvent.compositionStart(textarea);

      // Simulate Enter during composition
      fireEvent.keyDown(textarea, {
        key: 'Enter',
        shiftKey: false,
        nativeEvent: { isComposing: false },
      });

      // Assert - Should not send because internal composition state is true
      expect(mockProps.onSend).not.toHaveBeenCalled();
    });

    it('should handle composition end event', () => {
      // Arrange
      render(<ChatInput {...mockProps} value='Test' />);
      const textarea = screen.getByRole('textbox');

      // Act
      fireEvent.compositionStart(textarea);
      fireEvent.compositionEnd(textarea);

      // Simulate Enter after composition ends
      fireEvent.keyDown(textarea, {
        key: 'Enter',
        shiftKey: false,
        nativeEvent: { isComposing: false },
      });

      // Assert - Should send because composition has ended
      expect(mockProps.onSend).toHaveBeenCalledTimes(1);
    });

    it('should prevent Enter key action during composition', () => {
      // Arrange
      render(<ChatInput {...mockProps} value='测试' />);
      const textarea = screen.getByRole('textbox');

      // Act
      fireEvent.compositionStart(textarea);

      fireEvent.keyDown(textarea, {
        key: 'Enter',
        shiftKey: false,
        nativeEvent: { isComposing: true },
      });

      // Assert
      expect(mockProps.onSend).not.toHaveBeenCalled();
    });
  });

  describe('Disabled States', () => {
    it('should disable textarea when isLoading is true', () => {
      // Arrange & Act
      render(<ChatInput {...mockProps} isLoading={true} />);

      // Assert
      const textarea = screen.getByRole('textbox');
      expect(textarea).toBeDisabled();
    });

    it('should disable textarea when disabled prop is true', () => {
      // Arrange & Act
      render(<ChatInput {...mockProps} disabled={true} />);

      // Assert
      const textarea = screen.getByRole('textbox');
      expect(textarea).toBeDisabled();
    });

    it('should enable textarea when not loading and not disabled', () => {
      // Arrange & Act
      render(<ChatInput {...mockProps} isLoading={false} disabled={false} />);

      // Assert
      const textarea = screen.getByRole('textbox');
      expect(textarea).not.toBeDisabled();
    });
  });

  describe('Footer Information', () => {
    it('should display keyboard shortcuts information', () => {
      // Arrange & Act
      render(<ChatInput {...mockProps} />);

      // Assert - scope to footer region to avoid matching button text
      const footer = screen.getByRole('region', { name: '輸入說明' });
      expect(footer).toBeInTheDocument();
      expect(within(footer).getByText('傳送')).toBeInTheDocument();
      expect(within(footer).getByText('換行')).toBeInTheDocument();
    });

    it('should display Enter and Shift+Enter key hints', () => {
      // Arrange & Act
      render(<ChatInput {...mockProps} />);

      // Assert
      const enterKey = screen.getByLabelText('Enter 鍵');
      const shiftEnterKeys = screen.getByLabelText('Shift 加 Enter 鍵');

      expect(enterKey).toBeInTheDocument();
      expect(shiftEnterKeys).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA attributes', () => {
      // Arrange & Act
      render(<ChatInput {...mockProps} />);

      // Assert
      const textarea = screen.getByRole('textbox');
      expect(textarea).toHaveAttribute('aria-label', '輸入訊息');
      expect(textarea).toHaveAttribute('aria-describedby', 'input-help');
      expect(textarea).toHaveAttribute('aria-multiline', 'true');
    });

    it('should associate help text with input', () => {
      // Arrange & Act
      render(<ChatInput {...mockProps} />);

      // Assert
      const helpSection = screen.getByRole('region', { name: '輸入說明' });
      expect(helpSection).toBeInTheDocument();

      const textarea = screen.getByRole('textbox');
      expect(textarea).toHaveAttribute('aria-describedby', 'input-help');
    });

    it('should update button aria-label based on loading state', () => {
      // Arrange
      const { rerender } = render(<ChatInput {...mockProps} isLoading={false} />);

      // Assert - Not loading
      expect(screen.getByRole('button')).toHaveAttribute('aria-label', '傳送訊息');

      // Act - Set loading
      rerender(<ChatInput {...mockProps} isLoading={true} />);

      // Assert - Loading
      expect(screen.getByRole('button')).toHaveAttribute('aria-label', '正在傳送訊息');
    });
  });

  describe('Error Handling', () => {
    it('should handle extremely long input gracefully', () => {
      // Arrange
      const veryLongText = 'a'.repeat(50000);
      render(<ChatInput {...mockProps} />);

      // Act & Assert - Should not crash
      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: veryLongText } });

      expect(mockProps.onChange).toHaveBeenCalledWith(veryLongText);
    });

    it('should handle special characters in input', () => {
      // Arrange
      const specialChars = '!@#$%^&*()_+{}|:"<>?`~[]\\;\',./ 你好 🚀';
      render(<ChatInput {...mockProps} />);

      // Act - use fireEvent for controlled input to avoid cumulative-value issues
      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: specialChars } });

      // Assert
      expect(mockProps.onChange).toHaveBeenCalledWith(specialChars);
    });
  });
});
