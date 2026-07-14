import { useEffect, useMemo, useState } from 'react';
import type { SpeechUtteranceDoc } from '../../services/speechToolService';

const getSpeechSynthesis = (): Window['speechSynthesis'] | undefined => {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return undefined;
  }

  return window.speechSynthesis;
};

export const isSpeechSynthesisSupported = (): boolean =>
  Boolean(getSpeechSynthesis() && typeof window.SpeechSynthesisUtterance === 'function');

export const useSpeechPlayback = (utterance: SpeechUtteranceDoc) => {
  const [speaking, setSpeaking] = useState(false);
  const supported = useMemo(() => isSpeechSynthesisSupported(), []);

  useEffect(() => {
    return () => {
      const speechSynthesis = getSpeechSynthesis();
      if (supported && speechSynthesis) {
        speechSynthesis.cancel();
      }
    };
  }, [supported]);

  const stop = () => {
    const speechSynthesis = getSpeechSynthesis();
    if (!supported || !speechSynthesis) {
      return;
    }

    speechSynthesis.cancel();
    setSpeaking(false);
  };

  const speak = () => {
    const speechSynthesis = getSpeechSynthesis();
    if (!supported || !speechSynthesis) {
      return;
    }

    speechSynthesis.cancel();
    const speech = new window.SpeechSynthesisUtterance(utterance.text);
    speech.lang = utterance.language;
    speech.rate = utterance.rate;
    speech.pitch = utterance.pitch;
    speech.onend = () => setSpeaking(false);
    speech.onerror = () => setSpeaking(false);
    setSpeaking(true);
    speechSynthesis.speak(speech);
  };

  return { speaking, supported, speak, stop };
};
