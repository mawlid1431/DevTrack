/** A live call: LiveKit connection details plus the mic captured on tap. */
export type VoiceCallSession = {
  serverUrl: string;
  token: string;
  roomName: string;
  /** Microphone captured during the user's tap (required by iOS Safari). */
  micTrack?: MediaStreamTrack;
  /** Why the microphone could not be captured, if it failed. */
  micError?: string;
};

function isAppleMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/**
 * Turn any microphone failure (a DOMException from getUserMedia, a LiveKit
 * MediaDeviceFailure value, or an Error) into one honest, actionable line.
 */
export function describeMicError(error: unknown): string {
  const raw =
    typeof error === "string"
      ? error
      : error && typeof error === "object"
        ? `${(error as { name?: string }).name ?? ""} ${(error as { message?: string }).message ?? ""}`
        : "";
  const apple = isAppleMobile();
  if (/NotAllowed|PermissionDenied|Permission|denied/i.test(raw)) {
    return apple
      ? "Microphone access is off for this site. In Safari tap aA, then Website Settings, set Microphone to Allow, and start the call again. You can still type below."
      : "Microphone access is blocked for this site. Allow it from the icon in the address bar, then tap the mic. You can still type below.";
  }
  if (/NotFound|Overconstrained/i.test(raw)) {
    return "No microphone was found. Connect one, then tap the mic. You can still type below.";
  }
  if (/NotReadable|DeviceInUse|in use|audio source/i.test(raw)) {
    return apple
      ? "Your microphone is in use by something else (a phone or FaceTime call, or dictation). End it, then tap the mic. You can still type below."
      : "Your microphone is in use by another app or tab (Zoom, Teams, another call). Close it, then tap the mic. You can still type below.";
  }
  if (/insecure|secure context|mediaDevices/i.test(raw) || (typeof navigator !== "undefined" && !navigator.mediaDevices)) {
    return "This browser can't use the microphone on this page (it needs https). You can still type below.";
  }
  return "The microphone could not start. Tap the mic to try again, or type below.";
}
