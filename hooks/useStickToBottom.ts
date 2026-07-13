import { useCallback, useRef, useState } from 'react';

type ScrollBehaviorMode = 'auto' | 'smooth';

const DEFAULT_BOTTOM_THRESHOLD_PX = 100;

const getDistanceFromBottom = (element: HTMLElement): number => {
  return element.scrollHeight - element.scrollTop - element.clientHeight;
};

export const useStickToBottom = (thresholdPx = DEFAULT_BOTTOM_THRESHOLD_PX) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const updatePinnedState = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return true;
    }

    const nextIsAtBottom = getDistanceFromBottom(container) <= thresholdPx;
    setIsAtBottom(nextIsAtBottom);
    return nextIsAtBottom;
  }, [thresholdPx]);

  const handleScroll = useCallback(() => {
    updatePinnedState();
  }, [updatePinnedState]);

  const scrollToBottom = useCallback((behavior: ScrollBehaviorMode = 'smooth') => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    if (typeof container.scrollTo === 'function') {
      container.scrollTo({
        top: container.scrollHeight,
        behavior,
      });
    } else {
      container.scrollTop = container.scrollHeight;
    }
    setIsAtBottom(true);
  }, []);

  const resetScrollToTop = useCallback(() => {
    const container = containerRef.current;
    if (container) {
      if (typeof container.scrollTo === 'function') {
        container.scrollTo({ top: 0, behavior: 'auto' });
      } else {
        container.scrollTop = 0;
      }
    }
    setIsAtBottom(false);
  }, []);

  return {
    containerRef,
    isAtBottom,
    handleScroll,
    scrollToBottom,
    resetScrollToTop,
    updatePinnedState,
  };
};
