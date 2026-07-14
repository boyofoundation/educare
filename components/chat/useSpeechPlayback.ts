import { useEffect, useMemo, useRef, useState } from 'react';
import type { SpeechUtteranceDoc } from '../../services/speechToolService';

const getSpeechSynthesis = (): Window['speechSynthesis'] | undefined => {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return undefined;
  }

  return window.speechSynthesis;
};

export const isSpeechSynthesisSupported = (): boolean =>
  Boolean(getSpeechSynthesis() && typeof window.SpeechSynthesisUtterance === 'function');

interface ActiveSpeechPlayback {
  owner: symbol;
  setSpeaking: (speaking: boolean) => void;
}

let activeSpeechPlayback: ActiveSpeechPlayback | null = null;

export const useSpeechPlayback = (utterance: SpeechUtteranceDoc) => {
  const [speaking, setSpeaking] = useState(false);
  const supported = useMemo(() => isSpeechSynthesisSupported(), []);
  const ownerRef = useRef(Symbol('speech-playback-owner'));

  useEffect(() => {
    const owner = ownerRef.current;

    return () => {
      if (activeSpeechPlayback?.owner !== owner) {
        return;
      }

      activeSpeechPlayback = null;
      getSpeechSynthesis()?.cancel();
    };
  }, []);

  const stop = () => {
    const speechSynthesis = getSpeechSynthesis();
    if (!supported || !speechSynthesis) {
      return;
    }

    if (activeSpeechPlayback?.owner !== ownerRef.current) {
      setSpeaking(false);
      return;
    }

    activeSpeechPlayback = null;
    speechSynthesis.cancel();
    setSpeaking(false);
  };

  const speak = () => {
    const speechSynthesis = getSpeechSynthesis();
    if (!supported || !speechSynthesis) {
      return;
    }

    const previousPlayback = activeSpeechPlayback;
    activeSpeechPlayback = null;
    previousPlayback?.setSpeaking(false);
    speechSynthesis.cancel();

    const speech = new window.SpeechSynthesisUtterance(utterance.text);
    speech.lang = utterance.language;
    speech.rate = utterance.rate;
    speech.pitch = utterance.pitch;

    const playback: ActiveSpeechPlayback = {
      owner: ownerRef.current,
      setSpeaking,
    };
    const finishPlayback = () => {
      if (activeSpeechPlayback !== playback) {
        return;
      }

      activeSpeechPlayback = null;
      setSpeaking(false);
    };

    speech.onend = finishPlayback;
    speech.onerror = finishPlayback;
    activeSpeechPlayback = playback;
    setSpeaking(true);
    speechSynthesis.speak(speech);
  };

  return { speaking, supported, speak, stop };
};
