import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AssistantList } from '../AssistantList';
import { AssistantListProps } from '../types';
import { TEST_ASSISTANTS, setupAssistantTestEnvironment } from './test-utils';

// Mock dependencies
vi.mock('../ui/Icons', () => ({
  PlusIcon: ({ className }: { className?: string }) => {
    const React = require('react');
    return React.createElement(
      'svg',
      {
        'data-testid': 'plus-icon',
        className,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        xmlns: 'http://www.w3.org/2000/svg',
      },
      React.createElement('path', {
        d: 'M12 4v16m8-8H4',
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        strokeWidth: '2',
      }),
    );
  },
  EditIcon: ({ className }: { className?: string }) => {
    const React = require('react');
    return React.createElement('div', { 'data-testid': 'edit-icon', className }, 'Edit');
  },
  TrashIcon: ({ className }: { className?: string }) => {
    const React = require('react');
    return React.createElement('div', { 'data-testid': 'trash-icon', className }, 'Trash');
  },
}));

describe('AssistantList', () => {
  let mockProps: AssistantListProps;
  let testEnvironment: ReturnType<typeof setupAssistantTestEnvironment>;

  beforeEach(() => {
    testEnvironment = setupAssistantTestEnvironment();

    mockProps = {
      assistants: [TEST_ASSISTANTS.basic, TEST_ASSISTANTS.withRag],
      selectedAssistant: null,
      onSelect: vi.fn(),
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      onShare: vi.fn(),
      onCreateNew: vi.fn(),
    };
  });

  afterEach(() => {
    testEnvironment.cleanup();
  });

  describe('Rendering', () => {
    it('renders the assistant selection section', () => {
      render(<AssistantList {...mockProps} />);

      expect(screen.getByRole('navigation', { name: /助理選擇/i })).toBeInTheDocument();
      expect(screen.getByText('選擇助理')).toBeInTheDocument();
    });

    it('renders CustomSelect component with correct props', () => {
      render(<AssistantList {...mockProps} />);

      // CustomSelect renders as a button with placeholder text
      const selectButton = screen.getByRole('button', { name: /請選擇一個助理/ });
      expect(selectButton).toBeInTheDocument();
      expect(selectButton).toHaveAttribute('aria-expanded', 'false');
    });

    it('renders create new button', () => {
      render(<AssistantList {...mockProps} />);

      const createButton = screen.getByRole('button', { name: /新增助理/i });
      expect(createButton).toBeInTheDocument();
      expect(createButton).toHaveAttribute('title', '新增助理');
    });

    it('does not render action buttons when no assistant is selected', () => {
      render(<AssistantList {...mockProps} />);

      expect(screen.queryByRole('button', { name: /編輯助理/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /刪除助理/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /分享助理/i })).not.toBeInTheDocument();
    });

    it('renders action buttons when an assistant is selected', () => {
      const propsWithSelected = {
        ...mockProps,
        selectedAssistant: TEST_ASSISTANTS.basic,
      };

      render(<AssistantList {...propsWithSelected} />);

      expect(screen.getByRole('button', { name: /編輯助理/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /刪除助理/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /分享助理/i })).toBeInTheDocument();
    });
  });

  describe('User Interactions', () => {
    it('calls onCreateNew when create button is clicked', () => {
      render(<AssistantList {...mockProps} />);

      const createButton = screen.getByRole('button', { name: /新增助理/i });
      fireEvent.click(createButton);

      expect(mockProps.onCreateNew).toHaveBeenCalledTimes(1);
    });

    it('calls onSelect when an assistant is selected from dropdown', async () => {
      const assistants = [TEST_ASSISTANTS.basic, TEST_ASSISTANTS.withRag];
      const propsWithAssistants = {
        ...mockProps,
        assistants,
      };

      render(<AssistantList {...propsWithAssistants} />);

      // Click the dropdown button to open it
      const selectButton = screen.getByRole('button', { name: /請選擇一個助理/ });
      fireEvent.click(selectButton);

      // Wait for dropdown to open and click an option
      const option = await screen.findByText(TEST_ASSISTANTS.basic.name);
      fireEvent.click(option);

      expect(mockProps.onSelect).toHaveBeenCalledWith(TEST_ASSISTANTS.basic.id);
    });

    it('calls onEdit when edit button is clicked', () => {
      const propsWithSelected = {
        ...mockProps,
        selectedAssistant: TEST_ASSISTANTS.basic,
      };

      render(<AssistantList {...propsWithSelected} />);

      const editButton = screen.getByRole('button', { name: /編輯助理/i });
      fireEvent.click(editButton);

      expect(mockProps.onEdit).toHaveBeenCalledWith(TEST_ASSISTANTS.basic);
    });

    it('calls onDelete when delete button is clicked', () => {
      const propsWithSelected = {
        ...mockProps,
        selectedAssistant: TEST_ASSISTANTS.basic,
      };

      render(<AssistantList {...propsWithSelected} />);

      const deleteButton = screen.getByRole('button', { name: /刪除助理/i });
      fireEvent.click(deleteButton);

      expect(mockProps.onDelete).toHaveBeenCalledWith(TEST_ASSISTANTS.basic.id);
    });

    it('calls onShare when share button is clicked', () => {
      const propsWithSelected = {
        ...mockProps,
        selectedAssistant: TEST_ASSISTANTS.basic,
      };

      render(<AssistantList {...propsWithSelected} />);

      const shareButton = screen.getByRole('button', { name: /分享助理/i });
      fireEvent.click(shareButton);

      expect(mockProps.onShare).toHaveBeenCalledWith(TEST_ASSISTANTS.basic);
    });
  });

  describe('Accessibility', () => {
    it('has proper ARIA labels for all buttons', () => {
      const propsWithSelected = {
        ...mockProps,
        selectedAssistant: TEST_ASSISTANTS.basic,
      };

      render(<AssistantList {...propsWithSelected} />);

      expect(screen.getByRole('button', { name: /新增助理/i })).toHaveAttribute(
        'aria-label',
        '新增助理',
      );
      expect(screen.getByRole('button', { name: /編輯助理/i })).toHaveAttribute(
        'aria-label',
        '編輯助理',
      );
      expect(screen.getByRole('button', { name: /刪除助理/i })).toHaveAttribute(
        'aria-label',
        '刪除助理',
      );
      expect(screen.getByRole('button', { name: /分享助理/i })).toHaveAttribute(
        'aria-label',
        '分享助理',
      );
    });

    it('has proper navigation role and label', () => {
      render(<AssistantList {...mockProps} />);

      const navigation = screen.getByRole('navigation');
      expect(navigation).toHaveAttribute('aria-label', '助理選擇');
    });

    it('has proper title attributes for tooltips', () => {
      const propsWithSelected = {
        ...mockProps,
        selectedAssistant: TEST_ASSISTANTS.basic,
      };

      render(<AssistantList {...propsWithSelected} />);

      expect(screen.getByRole('button', { name: /新增助理/i })).toHaveAttribute(
        'title',
        '新增助理',
      );
      expect(screen.getByRole('button', { name: /編輯助理/i })).toHaveAttribute(
        'title',
        '編輯助理',
      );
      expect(screen.getByRole('button', { name: /刪除助理/i })).toHaveAttribute(
        'title',
        '刪除助理',
      );
      expect(screen.getByRole('button', { name: /分享助理/i })).toHaveAttribute(
        'title',
        '分享助理',
      );
    });
  });

  describe('Edge Cases', () => {
    it('handles empty assistants array', () => {
      const propsWithEmptyList = {
        ...mockProps,
        assistants: [],
      };

      render(<AssistantList {...propsWithEmptyList} />);

      // CustomSelect renders as a button with placeholder text
      const selectButton = screen.getByRole('button', { name: /請選擇一個助理/ });
      expect(selectButton).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /新增助理/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /編輯助理/i })).not.toBeInTheDocument();
    });

    it('handles null selectedAssistant', () => {
      const propsWithNullSelected = {
        ...mockProps,
        selectedAssistant: null,
      };

      render(<AssistantList {...propsWithNullSelected} />);

      // When no assistant is selected, shows placeholder text
      const selectButton = screen.getByRole('button', { name: /請選擇一個助理/ });
      expect(selectButton).toBeInTheDocument();
      expect(selectButton).toHaveTextContent('請選擇一個助理');
      expect(screen.queryByRole('button', { name: /編輯助理/i })).not.toBeInTheDocument();
    });

    it('updates selection when selectedAssistant prop changes', () => {
      const { rerender } = render(<AssistantList {...mockProps} />);

      // Initially shows placeholder
      let selectButton = screen.getByRole('button', { name: /請選擇一個助理/ });
      expect(selectButton).toHaveTextContent('請選擇一個助理');

      // After selecting an assistant, should show the assistant name in the dropdown button
      rerender(<AssistantList {...mockProps} selectedAssistant={TEST_ASSISTANTS.basic} />);

      // The select button now has a different aria-label with the selected assistant
      selectButton = screen.getByRole('button', { name: /已選擇: Basic Assistant/ });
      expect(selectButton).toHaveTextContent(TEST_ASSISTANTS.basic.name);
    });
  });

  describe('Collapsed Mode (Icon Rail)', () => {
    it('does not render the label or CustomSelect when collapsed', () => {
      render(<AssistantList {...mockProps} collapsed={true} />);

      expect(screen.queryByText('選擇助理')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '請選擇一個助理' })).not.toBeInTheDocument();
    });

    it('renders an avatar button per assistant with the first initial', () => {
      render(<AssistantList {...mockProps} collapsed={true} />);

      const basicBtn = screen.getByRole('button', { name: '選擇助理 Basic Assistant' });
      const ragBtn = screen.getByRole('button', { name: '選擇助理 RAG Assistant' });
      expect(basicBtn).toHaveTextContent('B');
      expect(ragBtn).toHaveTextContent('R');
      expect(basicBtn).toHaveAttribute('title', 'Basic Assistant');
    });

    it('calls onSelect when an avatar is clicked', () => {
      render(<AssistantList {...mockProps} collapsed={true} />);

      fireEvent.click(screen.getByRole('button', { name: '選擇助理 Basic Assistant' }));
      expect(mockProps.onSelect).toHaveBeenCalledWith(TEST_ASSISTANTS.basic.id);
    });

    it('renders a working new-assistant icon button', () => {
      render(<AssistantList {...mockProps} collapsed={true} />);

      fireEvent.click(screen.getByRole('button', { name: '新增助理' }));
      expect(mockProps.onCreateNew).toHaveBeenCalled();
    });

    it('renders compact edit/share/delete for the selected assistant', () => {
      render(
        <AssistantList {...mockProps} selectedAssistant={TEST_ASSISTANTS.basic} collapsed={true} />,
      );

      expect(screen.getByRole('button', { name: '編輯助理' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '刪除助理' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '分享助理' })).toBeInTheDocument();
    });

    it('marks the selected assistant avatar as pressed', () => {
      render(
        <AssistantList {...mockProps} selectedAssistant={TEST_ASSISTANTS.basic} collapsed={true} />,
      );

      expect(screen.getByRole('button', { name: '選擇助理 Basic Assistant' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });
  });

  describe('Styling and CSS Classes', () => {
    it('applies correct CSS classes to main container', () => {
      render(<AssistantList {...mockProps} />);

      // The navigation element itself has the CSS classes
      const container = screen.getByRole('navigation');
      expect(container).toHaveClass('mb-5', 'px-1');
    });

    it('applies hover styles to buttons', () => {
      const propsWithSelected = {
        ...mockProps,
        selectedAssistant: TEST_ASSISTANTS.basic,
      };

      render(<AssistantList {...propsWithSelected} />);

      const createButton = screen.getByRole('button', { name: /新增助理/i });
      expect(createButton).toHaveClass('hover:text-cyan-400', 'hover:bg-cyan-500/20');

      const editButton = screen.getByRole('button', { name: /編輯助理/i });
      expect(editButton).toHaveClass('hover:text-cyan-400', 'hover:bg-cyan-500/20');

      const deleteButton = screen.getByRole('button', { name: /刪除助理/i });
      expect(deleteButton).toHaveClass('hover:text-red-400', 'hover:bg-red-500/20');

      const shareButton = screen.getByRole('button', { name: /分享助理/i });
      expect(shareButton).toHaveClass('hover:text-blue-400', 'hover:bg-blue-500/20');
    });
  });
});
