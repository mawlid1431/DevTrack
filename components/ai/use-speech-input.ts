"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* Minimal typings for the Web Speech API (not in lib.dom for all TS versions). */
type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: { transcript: string };
};
type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Browser speech-to-text. `onTranscript` receives the running transcript
 * (final + interim) while listening; `onDone` fires once with the final text
 * when the user stops talking (or presses the mic again).
 */
export function useSpeechInput({
  onTranscript,
  onDone,
  onError,
}: {
  onTranscript: (text: string) => void;
  onDone: (text: string) => void;
  onError?: (message: string) => void;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef("");
  const latestRef = useRef("");
  const callbacks = useRef({ onTranscript, onDone, onError });
  useEffect(() => {
    callbacks.current = { onTranscript, onDone, onError };
  });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only feature detection
    setSupported(getRecognitionCtor() !== null);
    return () => recognitionRef.current?.abort();
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor || recognitionRef.current) return;
    const recognition = new Ctor();
    recognition.lang = navigator.language || "en-US";
    recognition.continuous = false; // stop automatically after a pause
    recognition.interimResults = true;
    finalRef.current = "";
    latestRef.current = "";

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalRef.current += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      latestRef.current = (finalRef.current + interim).trim();
      callbacks.current.onTranscript(latestRef.current);
    };
    recognition.onerror = (event) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      callbacks.current.onError?.(
        event.error === "not-allowed"
          ? "Microphone access was blocked. Allow it in your browser to talk to the agent."
          : `Voice input failed (${event.error}).`
      );
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
      const text = latestRef.current.trim();
      if (text) callbacks.current.onDone(text);
    };

    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }, []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  return { supported, listening, start, stop };
}
