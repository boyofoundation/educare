import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ModalProps } from './types';

interface ModalStackEntry {
  id: string;
  onClose: () => void;
  dialog: HTMLDivElement | null;
}

interface InertElementState {
  inert: boolean;
  ariaHidden: string | null;
}

const modalStack: ModalStackEntry[] = [];
let bodyOverflowBeforeModal: string | null = null;

const isTopmostModal = (id: string): boolean => modalStack.at(-1)?.id === id;

const focusableSelector = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'object',
  'embed',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const getFocusableElements = (dialog: HTMLDivElement): HTMLElement[] =>
  Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter(element => {
    const style = window.getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none';
  });

const focusElement = (element: HTMLElement | null): void => {
  if (!element || !element.isConnected) {
    return;
  }
  element.focus({ preventScroll: true });
};

const lockBodyScroll = (): void => {
  // The extra null check keeps the lock recoverable if a React concurrent
  // commit briefly overlaps an effect cleanup and setup.
  if (modalStack.length === 0 || bodyOverflowBeforeModal === null) {
    bodyOverflowBeforeModal = document.body.style.overflow;
  }
  document.body.style.overflow = 'hidden';
};

const unlockBodyScroll = (): void => {
  if (modalStack.length > 0) {
    return;
  }
  document.body.style.overflow = bodyOverflowBeforeModal ?? '';
  bodyOverflowBeforeModal = null;
};

const inertBackground = (portal: HTMLDivElement | null): Map<HTMLElement, InertElementState> => {
  const previousState = new Map<HTMLElement, InertElementState>();
  if (!portal) {
    return previousState;
  }

  Array.from(document.body.children).forEach(child => {
    if (
      child === portal ||
      !(child instanceof HTMLElement) ||
      child.dataset.modalPortal === 'true'
    ) {
      return;
    }
    previousState.set(child, {
      inert: child.inert === true,
      ariaHidden: child.getAttribute('aria-hidden'),
    });
    child.inert = true;
    child.setAttribute('aria-hidden', 'true');
  });

  return previousState;
};

const restoreBackground = (previousState: Map<HTMLElement, InertElementState>): void => {
  previousState.forEach((state, element) => {
    if (!element.isConnected) {
      return;
    }
    element.inert = state.inert;
    if (state.ariaHidden === null) {
      element.removeAttribute('aria-hidden');
    } else {
      element.setAttribute('aria-hidden', state.ariaHidden);
    }
  });
};

const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  ariaLabel,
  children,
  className = '',
  size = 'default',
  closeButtonLabel = '關閉對話框',
}) => {
  const modalId = useId();
  const titleId = `modal-title-${modalId}`;
  const portalRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    previousActiveElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const entry: ModalStackEntry = {
      id: modalId,
      onClose: () => onCloseRef.current(),
      dialog: dialogRef.current,
    };
    modalStack.push(entry);
    lockBodyScroll();
    const previousBackgroundState = inertBackground(portalRef.current);

    const focusInitialElement = () => {
      entry.dialog = dialogRef.current;
      const dialog = entry.dialog;
      if (!dialog) {
        return;
      }
      const autoFocusElement = dialog.querySelector<HTMLElement>('[autofocus]');
      focusElement(autoFocusElement ?? getFocusableElements(dialog)[0] ?? dialog);
    };

    // The portal is committed before effects run, so focus synchronously. A
    // microtask also covers content that becomes available in the same commit.
    focusInitialElement();
    void Promise.resolve().then(focusInitialElement);

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!isTopmostModal(modalId)) {
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        entry.onClose();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const dialog = dialogRef.current;
      if (!dialog) {
        return;
      }

      const focusable = getFocusableElements(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        focusElement(dialog);
        return;
      }

      const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
      const nextIndex = event.shiftKey
        ? currentIndex <= 0
          ? focusable.length - 1
          : currentIndex - 1
        : currentIndex === -1 || currentIndex === focusable.length - 1
          ? 0
          : currentIndex + 1;

      event.preventDefault();
      focusElement(focusable[nextIndex]);
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const stackIndex = modalStack.findIndex(item => item.id === modalId);
      if (stackIndex !== -1) {
        modalStack.splice(stackIndex, 1);
      }
      unlockBodyScroll();
      restoreBackground(previousBackgroundState);

      const previous = previousActiveElementRef.current;
      if (previous?.isConnected) {
        focusElement(previous);
      }
    };
  }, [isOpen, modalId]);

  if (!isOpen) {
    return null;
  }

  const sizeClassName =
    size === 'fullscreen'
      ? 'h-[calc(100vh-2rem)] max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)]'
      : size === 'wide'
        ? 'max-h-[90vh] max-w-5xl'
        : 'max-h-[90vh] max-w-lg';

  return createPortal(
    <div
      ref={portalRef}
      data-modal-portal='true'
      className='fixed inset-0 z-50 flex items-center justify-center p-4'
    >
      {/* Backdrop */}
      <div
        className='fixed inset-0 bg-black/50 backdrop-blur-sm'
        onClick={event => {
          if (event.target === event.currentTarget && isTopmostModal(modalId)) {
            onCloseRef.current();
          }
        }}
        aria-hidden='true'
      />

      {/* Modal */}
      <div
        ref={dialogRef}
        className={`relative flex w-full flex-col overflow-hidden rounded-2xl bg-gray-800 shadow-2xl ${sizeClassName} ${className}`}
        role='dialog'
        aria-modal='true'
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : ariaLabel || '對話框'}
        tabIndex={-1}
      >
        {/* Header */}
        {title && (
          <div className='flex items-center justify-between border-b border-gray-700 p-6'>
            <h2 id={titleId} className='text-xl font-semibold text-white'>
              {title}
            </h2>
            <button
              type='button'
              onClick={() => onCloseRef.current()}
              className='rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-700/50 hover:text-white'
              aria-label={closeButtonLabel}
            >
              <svg className='w-5 h-5' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M6 18L18 6M6 6l12 12'
                />
              </svg>
            </button>
          </div>
        )}

        {/* Content */}
        <div className='flex-1 overflow-y-auto p-6'>{children}</div>
      </div>
    </div>,
    document.body,
  );
};

export default Modal;
