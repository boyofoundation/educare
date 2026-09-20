import React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'icon' | 'danger' | 'ghost';

export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<globalThis.HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  children: React.ReactNode;
  className?: string;
}

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  /** Accessible name used when a dialog does not render a visible title. */
  ariaLabel?: string;
  children: React.ReactNode;
  className?: string;
  size?: 'default' | 'wide' | 'fullscreen';
  /** Allows specialised dialogs to keep a shorter visible close label. */
  closeButtonLabel?: string;
}

export interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  isMobile?: boolean;
  isTablet?: boolean;
}
