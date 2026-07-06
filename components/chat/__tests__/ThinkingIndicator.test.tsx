import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import ThinkingIndicator from '../ThinkingIndicator';
import { setupTestEnvironment } from './test-utils';

vi.mock('../../ui/Icons', () => ({
  GeminiIcon: ({ className }: { className?: string }) => (
    <span data-testid='gemini-icon' className={className}>
      Gemini
    </span>
  ),
  UserIcon: ({ className }: { className?: string }) => (
    <span data-testid='user-icon' className={className}>
      User
    </span>
  ),
}));

describe('ThinkingIndicator', () => {
  let testEnv: ReturnType<typeof setupTestEnvironment>;

  beforeEach(() => {
    testEnv = setupTestEnvironment();
  });

  afterEach(() => {
    testEnv.cleanup();
  });

  describe('Basic Rendering', () => {
    it('should render thinking indicator with proper structure', () => {
      // Arrange & Act
      render(<ThinkingIndicator />);

      // Assert
      expect(screen.getByText('AI 正在思考...')).toBeInTheDocument();
      expect(screen.getByTestId('gemini-icon')).toBeInTheDocument();
    });

    it('should have proper layout structure similar to message bubbles', () => {
      // Arrange & Act
      render(<ThinkingIndicator />);

      // Assert
      const container = screen.getByText('AI 正在思考...').closest('.flex.justify-start');
      expect(container).toBeInTheDocument();
      expect(container?.querySelector('.max-w-3xl')).toBeInTheDocument();
    });

    it('should render with assistant-style layout (left-aligned)', () => {
      // Arrange & Act
      render(<ThinkingIndicator />);

      // Assert
      const mainContainer = screen.getByText('AI 正在思考...').closest('.flex.justify-start');
      expect(mainContainer).toBeInTheDocument();
    });
  });

  describe('Icon Rendering', () => {
    it('should render Gemini icon with proper styling', () => {
      // Arrange & Act
      render(<ThinkingIndicator />);

      // Assert
      const icon = screen.getByTestId('gemini-icon');
      expect(icon).toBeInTheDocument();
      expect(icon).toHaveClass('w-5', 'h-5', 'text-cyan-400', 'animate-pulse');
    });

    it('should render icon container with proper styling', () => {
      // Arrange & Act
      render(<ThinkingIndicator />);

      // Assert
      const iconContainer = screen.getByTestId('gemini-icon').closest('div');
      expect(iconContainer).toHaveClass(
        'w-10',
        'h-10',
        'bg-gradient-to-br',
        'from-gray-700',
        'to-gray-600',
        'rounded-full',
        'flex',
        'items-center',
        'justify-center',
        'shadow-lg',
        'ring-1',
        'ring-gray-600/30',
      );
    });
  });

  describe('Animation Elements', () => {
    it('should render three bouncing dots', () => {
      // Arrange & Act
      render(<ThinkingIndicator />);

      // Assert
      const container = screen.getByText('AI 正在思考...').closest('.bg-gray-800\\/80');
      const bouncingDots = container?.querySelectorAll(
        '.w-2.h-2.bg-cyan-400.rounded-full.animate-bounce',
      );

      expect(bouncingDots).toHaveLength(3);

      // Check each dot has proper styling
      bouncingDots?.forEach(dot => {
        expect(dot).toHaveClass('w-2', 'h-2', 'bg-cyan-400', 'rounded-full', 'animate-bounce');
      });
    });

    it('should apply staggered animation delays to dots', () => {
      // Arrange & Act
      render(<ThinkingIndicator />);

      // Assert
      const container = screen.getByText('AI 正在思考...').closest('.bg-gray-800\\/80');
      const dots = container?.querySelectorAll('.animate-bounce');

      expect(dots).toHaveLength(3);
      expect(dots?.[0]).toHaveStyle({ animationDelay: '0ms' });
      expect(dots?.[1]).toHaveStyle({ animationDelay: '150ms' });
      expect(dots?.[2]).toHaveStyle({ animationDelay: '300ms' });
    });

    it('should have proper spacing between animation elements', () => {
      // Arrange & Act
      render(<ThinkingIndicator />);

      // Assert
      const animationContainer = screen
        .getByText('AI 正在思考...')
        .closest('.flex.items-center.space-x-3');
      expect(animationContainer).toBeInTheDocument();

      const dotsContainer = animationContainer?.querySelector('.flex.space-x-1');
      expect(dotsContainer).toBeInTheDocument();
    });
  });

  describe('Text Content', () => {
    it('should display thinking message in Chinese', () => {
      // Arrange & Act
      render(<ThinkingIndicator />);

      // Assert
      const thinkingText = screen.getByText('AI 正在思考...');
      expect(thinkingText).toBeInTheDocument();
    });

    it('should apply proper styling to thinking text', () => {
      // Arrange & Act
      render(<ThinkingIndicator />);

      // Assert
      const thinkingText = screen.getByText('AI 正在思考...');
      expect(thinkingText).toHaveClass('text-gray-300', 'text-sm', 'font-medium');
    });
  });

  describe('Container Styling', () => {
    it('should apply proper bubble styling', () => {
      // Arrange & Act
      render(<ThinkingIndicator />);

      // Assert
      const bubble = screen.getByText('AI 正在思考...').closest('.bg-gray-800\\/80');
      expect(bubble).toHaveClass(
        'bg-gray-800/80',
        'backdrop-blur-sm',
        'text-gray-100',
        'px-5',
        'py-4',
        'rounded-2xl',
        'rounded-bl-md',
        'shadow-lg',
        'border',
        'border-gray-700/50',
      );
    });

    it('should match assistant message bubble styling', () => {
      // Arrange & Act
      render(<ThinkingIndicator />);

      // Assert
      const bubble = screen.getByText('AI 正在思考...').closest('.rounded-2xl.rounded-bl-md');
      expect(bubble).toBeInTheDocument();
    });

    it('should have flexible layout structure', () => {
      // Arrange & Act
      render(<ThinkingIndicator />);

      // Assert
      const flexContainer = screen.getByText('AI 正在思考...').closest('.flex.flex-col');
      expect(flexContainer).toBeInTheDocument();
    });
  });

  describe('Props Handling', () => {
    it('should accept assistantName prop but not display it', () => {
      render(<ThinkingIndicator assistantName='Test Assistant' />);

      expect(screen.getByText('AI 正在思考...')).toBeInTheDocument();
      expect(screen.queryByText('Test Assistant')).not.toBeInTheDocument();
    });

    it('should render provided status text inside the indicator bubble', () => {
      render(<ThinkingIndicator statusText='整理工具結果中...' />);

      expect(screen.getByText('整理工具結果中...')).toBeInTheDocument();
      expect(screen.queryByText('AI 正在思考...')).not.toBeInTheDocument();
    });

    it('should render the same regardless of assistantName prop', () => {
      // Arrange
      const { container: container1 } = render(<ThinkingIndicator />);
      const { container: container2 } = render(
        <ThinkingIndicator assistantName='Different Name' />,
      );

      // Act & Assert
      expect(container1.innerHTML).toBe(container2.innerHTML);
    });
  });

  describe('Animation Behavior', () => {
    it('should have animate-pulse class on the icon', () => {
      // Arrange & Act
      render(<ThinkingIndicator />);

      // Assert
      const icon = screen.getByTestId('gemini-icon');
      expect(icon).toHaveClass('animate-pulse');
    });

    it('should have animate-bounce class on all dots', () => {
      // Arrange & Act
      render(<ThinkingIndicator />);

      // Assert
      const container = screen.getByText('AI 正在思考...').closest('.bg-gray-800\\/80');
      const dots = container?.querySelectorAll('.w-2.h-2.bg-cyan-400.rounded-full');

      expect(dots).toHaveLength(3);
      dots?.forEach(dot => {
        expect(dot).toHaveClass('animate-bounce');
      });
    });

    it('should create a visual thinking animation sequence', () => {
      // Arrange & Act
      render(<ThinkingIndicator />);

      // Assert
      // Check that we have both pulsing icon and bouncing dots
      expect(screen.getByTestId('gemini-icon')).toHaveClass('animate-pulse');

      const bouncingElements = document.querySelectorAll('.animate-bounce');
      expect(bouncingElements.length).toBeGreaterThan(0);
    });
  });

  describe('Accessibility', () => {
    it('should convey loading state to screen readers', () => {
      // Arrange & Act
      render(<ThinkingIndicator />);

      // Assert
      const thinkingText = screen.getByText('AI 正在思考...');
      expect(thinkingText).toBeInTheDocument();

      // The text itself serves as the accessible label for the loading state
      expect(thinkingText.tagName).toBe('SPAN');
    });

    it('should have proper semantic structure', () => {
      // Arrange & Act
      render(<ThinkingIndicator />);

      // Assert
      // Check that the component has a clear structure that screen readers can navigate
      const mainContainer = screen.getByText('AI 正在思考...').closest('.flex');
      expect(mainContainer).toBeInTheDocument();
    });

    it('should not have any interactive elements', () => {
      // Arrange & Act
      render(<ThinkingIndicator />);

      // Assert
      // Thinking indicator should be purely visual - no buttons or interactive elements
      const buttons = screen.queryAllByRole('button');
      const links = screen.queryAllByRole('link');
      const inputs = screen.queryAllByRole('textbox');

      expect(buttons).toHaveLength(0);
      expect(links).toHaveLength(0);
      expect(inputs).toHaveLength(0);
    });
  });

  describe('Visual Consistency', () => {
    it('should use consistent color scheme with other components', () => {
      // Arrange & Act
      render(<ThinkingIndicator />);

      // Assert
      // Check for cyan-400 theme color used throughout the app
      const icon = screen.getByTestId('gemini-icon');
      expect(icon).toHaveClass('text-cyan-400');

      const dots = document.querySelectorAll('.bg-cyan-400');
      expect(dots.length).toBe(3);
    });

    it('should use consistent typography with other components', () => {
      // Arrange & Act
      render(<ThinkingIndicator />);

      // Assert
      const text = screen.getByText('AI 正在思考...');
      expect(text).toHaveClass('text-sm', 'font-medium');
    });

    it('should match assistant message visual style', () => {
      // Arrange & Act
      render(<ThinkingIndicator />);

      // Assert
      const bubble = screen.getByText('AI 正在思考...').closest('.bg-gray-800\\/80');

      // Should use same background and styling as assistant messages
      expect(bubble).toHaveClass('bg-gray-800/80', 'backdrop-blur-sm');
    });
  });

  describe('Edge Cases', () => {
    it('should render consistently across multiple instances', () => {
      // Arrange
      const { container: container1 } = render(<ThinkingIndicator />);
      const { container: container2 } = render(<ThinkingIndicator />);

      // Act & Assert
      expect(container1.innerHTML).toBe(container2.innerHTML);
    });

    it('should not crash with undefined props', () => {
      // Arrange & Act & Assert
      expect(() => {
        render(<ThinkingIndicator assistantName={undefined} />);
      }).not.toThrow();
    });

    it('should maintain structure when rendered multiple times rapidly', () => {
      // Arrange
      const { rerender } = render(<ThinkingIndicator />);

      // Act - Simulate rapid re-renders
      for (let i = 0; i < 5; i++) {
        rerender(<ThinkingIndicator assistantName={`Assistant ${i}`} />);
      }

      // Assert
      expect(screen.getByText('AI 正在思考...')).toBeInTheDocument();
      expect(screen.getByTestId('gemini-icon')).toBeInTheDocument();
    });
  });
});
