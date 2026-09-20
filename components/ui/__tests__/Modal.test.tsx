import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import Modal from '../Modal';

const NestedModalHarness = () => {
  const [outerOpen, setOuterOpen] = React.useState(false);
  const [innerOpen, setInnerOpen] = React.useState(false);

  return (
    <>
      <button type='button' onClick={() => setOuterOpen(true)}>
        Open outer
      </button>
      <Modal isOpen={outerOpen} onClose={() => setOuterOpen(false)} title='Outer dialog'>
        <button type='button' onClick={() => setInnerOpen(true)}>
          Open inner
        </button>
        <Modal isOpen={innerOpen} onClose={() => setInnerOpen(false)} title='Inner dialog'>
          <button type='button'>Inner action</button>
        </Modal>
      </Modal>
    </>
  );
};

describe('Modal', () => {
  it('does not render when isOpen is false', () => {
    render(
      <Modal isOpen={false} onClose={vi.fn()}>
        <div>Modal content</div>
      </Modal>,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders a uniquely labelled dialog when open', () => {
    render(
      <>
        <Modal isOpen={true} onClose={vi.fn()} title='First Modal'>
          <div>First content</div>
        </Modal>
        <Modal isOpen={true} onClose={vi.fn()} title='Second Modal'>
          <div>Second content</div>
        </Modal>
      </>,
    );

    const dialogs = screen.getAllByRole('dialog');
    expect(dialogs).toHaveLength(2);
    const labels = dialogs.map(dialog => dialog.getAttribute('aria-labelledby'));
    expect(labels[0]).toBeTruthy();
    expect(labels[0]).not.toBe(labels[1]);
    expect(screen.getByText('First content')).toBeInTheDocument();
    expect(screen.getByText('Second content')).toBeInTheDocument();
  });

  it('keeps focus in the topmost modal when nested modals open in one commit', () => {
    render(
      <>
        <Modal isOpen={true} onClose={vi.fn()} title='Outer dialog'>
          <button type='button'>Outer action</button>
        </Modal>
        <Modal isOpen={true} onClose={vi.fn()} title='Inner dialog'>
          <button type='button'>Inner action</button>
        </Modal>
      </>,
    );

    expect(
      screen.getByRole('dialog', { name: 'Inner dialog' }).contains(document.activeElement),
    ).toBe(true);
  });

  it('uses an accessible label when no visible title is provided', () => {
    render(
      <Modal isOpen={true} onClose={vi.fn()} ariaLabel='Custom dialog'>
        <div>Modal content</div>
      </Modal>,
    );

    expect(screen.getByRole('dialog', { name: 'Custom dialog' })).toBeInTheDocument();
  });

  it('inerts background content while open and restores it after close', () => {
    const background = document.createElement('main');
    document.body.appendChild(background);
    const { unmount } = render(
      <Modal isOpen={true} onClose={vi.fn()} title='Inert dialog'>
        <div>Modal content</div>
      </Modal>,
    );

    expect(background).toHaveAttribute('aria-hidden', 'true');
    expect(background.inert).toBe(true);

    unmount();

    expect(background).not.toHaveAttribute('aria-hidden');
    expect(background.inert).toBe(false);
    background.remove();
  });

  it('preserves original background inert and aria-hidden states after close', () => {
    const background = document.createElement('main');
    background.inert = true;
    background.setAttribute('aria-hidden', 'false');
    document.body.appendChild(background);

    const { unmount } = render(
      <Modal isOpen={true} onClose={vi.fn()} title='Inert dialog'>
        <div>Modal content</div>
      </Modal>,
    );

    expect(background).toHaveAttribute('aria-hidden', 'true');
    expect(background.inert).toBe(true);

    unmount();

    expect(background).toHaveAttribute('aria-hidden', 'false');
    expect(background.inert).toBe(true);
    background.remove();
  });

  it('keeps background inert and focus in the topmost modal when a lower modal closes first', () => {
    const background = document.createElement('main');
    document.body.appendChild(background);

    const { rerender } = render(
      <>
        <Modal isOpen={true} onClose={vi.fn()} title='Outer dialog'>
          <button type='button'>Outer action</button>
        </Modal>
        <Modal isOpen={true} onClose={vi.fn()} title='Inner dialog'>
          <button type='button'>Inner action</button>
        </Modal>
      </>,
    );

    const innerAction = screen.getByRole('button', { name: 'Inner action' });
    innerAction.focus();

    rerender(
      <>
        <Modal isOpen={false} onClose={vi.fn()} title='Outer dialog'>
          <button type='button'>Outer action</button>
        </Modal>
        <Modal isOpen={true} onClose={vi.fn()} title='Inner dialog'>
          <button type='button'>Inner action</button>
        </Modal>
      </>,
    );

    expect(background).toHaveAttribute('aria-hidden', 'true');
    expect(background.inert).toBe(true);
    expect(document.activeElement).toBe(innerAction);

    rerender(
      <>
        <Modal isOpen={false} onClose={vi.fn()} title='Outer dialog'>
          <button type='button'>Outer action</button>
        </Modal>
        <Modal isOpen={false} onClose={vi.fn()} title='Inner dialog'>
          <button type='button'>Inner action</button>
        </Modal>
      </>,
    );
    expect(background).not.toHaveAttribute('aria-hidden');
    expect(background.inert).toBe(false);
    background.remove();
  });

  it('keeps Escape scoped to the topmost modal when both open in one commit', () => {
    const outerClose = vi.fn();
    const innerClose = vi.fn();

    render(
      <>
        <Modal isOpen={true} onClose={outerClose} title='Outer dialog'>
          <div>Outer content</div>
        </Modal>
        <Modal isOpen={true} onClose={innerClose} title='Inner dialog'>
          <div>Inner content</div>
        </Modal>
      </>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(innerClose).toHaveBeenCalledTimes(1);
    expect(outerClose).not.toHaveBeenCalled();
  });

  it('does not focus a modal again after it has been cleaned up', async () => {
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.textContent = 'Trigger';
    document.body.appendChild(trigger);
    trigger.focus();

    const { rerender } = render(
      <Modal isOpen={true} onClose={vi.fn()} title='Async dialog'>
        <button type='button'>Action</button>
      </Modal>,
    );

    rerender(
      <Modal isOpen={false} onClose={vi.fn()} title='Async dialog'>
        <button type='button'>Action</button>
      </Modal>,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('does not restore focus to a trigger inside a hidden or inert ancestor', () => {
    const { rerender } = render(
      <>
        <div data-testid='trigger-ancestor'>
          <button type='button'>Trigger</button>
        </div>
        <Modal isOpen={false} onClose={vi.fn()} title='Focus dialog'>
          <button type='button'>Action</button>
        </Modal>
      </>,
    );

    const trigger = screen.getByRole('button', { name: 'Trigger' });
    const ancestor = screen.getByTestId('trigger-ancestor');
    trigger.focus();
    ancestor.hidden = true;
    ancestor.inert = true;

    rerender(
      <>
        <div data-testid='trigger-ancestor'>
          <button type='button'>Trigger</button>
        </div>
        <Modal isOpen={true} onClose={vi.fn()} title='Focus dialog'>
          <button type='button'>Action</button>
        </Modal>
      </>,
    );

    rerender(
      <>
        <div data-testid='trigger-ancestor'>
          <button type='button'>Trigger</button>
        </div>
        <Modal isOpen={false} onClose={vi.fn()} title='Focus dialog'>
          <button type='button'>Action</button>
        </Modal>
      </>,
    );

    expect(document.activeElement).not.toBe(trigger);
  });

  it('calls onClose when backdrop, close button, or Escape is used', () => {
    const handleClose = vi.fn();
    render(
      <Modal isOpen={true} onClose={handleClose} title='Test Modal'>
        <div>Modal content</div>
      </Modal>,
    );

    const backdrop = document.querySelector('.fixed.inset-0.bg-black\\/50');
    expect(backdrop).toBeInTheDocument();
    fireEvent.click(backdrop!);
    expect(handleClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '關閉對話框' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(handleClose).toHaveBeenCalledTimes(3);
  });

  it('ignores non-dismissal keys', () => {
    const handleClose = vi.fn();
    render(
      <Modal isOpen={true} onClose={handleClose}>
        <div>Modal content</div>
      </Modal>,
    );

    fireEvent.keyDown(document, { key: 'Enter' });
    fireEvent.keyDown(document, { key: ' ' });
    expect(handleClose).not.toHaveBeenCalled();
  });

  it('traps Tab focus within the topmost dialog', () => {
    render(
      <Modal isOpen={true} onClose={vi.fn()} title='Focus dialog'>
        <button type='button'>First action</button>
        <button type='button'>Second action</button>
      </Modal>,
    );

    const closeButton = screen.getByRole('button', { name: '關閉對話框' });
    const firstAction = screen.getByRole('button', { name: 'First action' });
    const secondAction = screen.getByRole('button', { name: 'Second action' });

    secondAction.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(closeButton);

    firstAction.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(closeButton);
  });

  it('restores focus to the trigger after close', () => {
    const handleClose = vi.fn();
    const closed = (
      <>
        <button type='button' onClick={() => undefined}>
          Trigger
        </button>
        <Modal isOpen={false} onClose={handleClose} title='Focus dialog'>
          <button type='button'>Action</button>
        </Modal>
      </>
    );
    const { rerender } = render(closed);

    const trigger = screen.getByRole('button', { name: 'Trigger' });
    trigger.focus();

    rerender(
      <>
        <button type='button' onClick={() => undefined}>
          Trigger
        </button>
        <Modal isOpen={true} onClose={handleClose} title='Focus dialog'>
          <button type='button'>Action</button>
        </Modal>
      </>,
    );
    expect(document.activeElement).not.toBe(trigger);

    rerender(closed);

    expect(document.activeElement).toBe(trigger);
  });

  it('only dismisses the topmost nested dialog on Escape', () => {
    render(<NestedModalHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open outer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open inner' }));

    expect(screen.getAllByRole('dialog')).toHaveLength(2);
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Inner dialog' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Outer dialog' })).toBeInTheDocument();
  });

  it('keeps body scroll locked for nested dialogs and restores prior overflow', () => {
    document.body.style.overflow = 'scroll';
    const { rerender } = render(
      <Modal isOpen={true} onClose={vi.fn()} title='Outer'>
        <div>Outer</div>
      </Modal>,
    );
    expect(document.body.style.overflow).toBe('hidden');

    rerender(
      <>
        <Modal isOpen={true} onClose={vi.fn()} title='Outer'>
          <div>Outer</div>
        </Modal>
        <Modal isOpen={true} onClose={vi.fn()} title='Inner'>
          <div>Inner</div>
        </Modal>
      </>,
    );
    expect(document.body.style.overflow).toBe('hidden');

    rerender(
      <Modal isOpen={false} onClose={vi.fn()} title='Outer'>
        <div>Outer</div>
      </Modal>,
    );
    expect(document.body.style.overflow).toBe('scroll');
    document.body.style.overflow = '';
  });

  it('keeps body scroll locked when a lower modal closes before the topmost modal', () => {
    document.body.style.overflow = 'auto';
    const { rerender } = render(
      <>
        <Modal isOpen={true} onClose={vi.fn()} title='Outer'>
          <div>Outer</div>
        </Modal>
        <Modal isOpen={true} onClose={vi.fn()} title='Inner'>
          <div>Inner</div>
        </Modal>
      </>,
    );

    rerender(
      <>
        <Modal isOpen={false} onClose={vi.fn()} title='Outer'>
          <div>Outer</div>
        </Modal>
        <Modal isOpen={true} onClose={vi.fn()} title='Inner'>
          <div>Inner</div>
        </Modal>
      </>,
    );
    expect(document.body.style.overflow).toBe('hidden');

    rerender(
      <>
        <Modal isOpen={false} onClose={vi.fn()} title='Outer'>
          <div>Outer</div>
        </Modal>
        <Modal isOpen={false} onClose={vi.fn()} title='Inner'>
          <div>Inner</div>
        </Modal>
      </>,
    );
    expect(document.body.style.overflow).toBe('auto');
    document.body.style.overflow = '';
  });

  it('applies custom className and size classes', () => {
    render(
      <Modal isOpen={true} onClose={vi.fn()} className='custom-modal' size='wide'>
        <div>Modal content</div>
      </Modal>,
    );

    const modal = screen.getByRole('dialog');
    expect(modal).toHaveClass('custom-modal', 'max-w-5xl', 'max-h-[90vh]');
  });
});
