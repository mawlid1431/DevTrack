"use client";

import {
  BarVisualizer,
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
  TrackToggle,
  VideoTrack,
  useConnectionState,
  useVoiceAssistant,
} from "@livekit/components-react";
import { ConnectionState, Track } from "livekit-client";
import { MicOff, PhoneOff } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

export type VoiceCallSession = { serverUrl: string; token: string; roomName: string };

const STATE_LABEL: Record<string, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting…",
  initializing: "Getting ready…",
  "pre-connect-buffering": "Getting ready…",
  idle: "Waiting for the agent…",
  listening: "Listening. Just talk",
  thinking: "Working on it…",
  speaking: "Speaking",
  failed: "The agent couldn't join",
};

/**
 * A live LiveKit voice call with the DevTrack voice worker. The worker hears
 * the user, runs workspace actions through the DevTrack agent, and talks
 * back; the transcript + actions land in the same chat thread above.
 */
export function VoiceCall({
  session,
  onEnd,
  onError,
}: {
  session: VoiceCallSession;
  onEnd: () => void;
  onError: (message: string) => void;
}) {
  // A broken/busy microphone must not end the call: stay connected, explain,
  // and let the user retry the mic (or keep listening to the agent).
  const [micProblem, setMicProblem] = useState<string | null>(null);

  return (
    <LiveKitRoom
      key={session.roomName}
      serverUrl={session.serverUrl}
      token={session.token}
      connect
      audio
      video={false}
      onDisconnected={onEnd}
      onError={(error) => {
        // Our own hang-up surfaces as a "cancelled" ConnectionError, not a failure.
        if (/client initiated disconnect|cancel/i.test(error.message)) return;
        if (isMicError(error)) {
          setMicProblem(micMessage(error));
          return;
        }
        onError(error.message || "The call dropped.");
      }}
      onMediaDeviceFailure={(_failure, kind) => {
        if (kind === undefined || kind === "audioinput") {
          setMicProblem(micMessage());
        }
      }}
      className="relative"
    >
      <CallStage
        onEnd={onEnd}
        micProblem={micProblem}
        onMicRetry={() => setMicProblem(null)}
        onMicError={(error) => setMicProblem(micMessage(error))}
      />
      <RoomAudioRenderer />
      <StartAudio
        label="Tap to hear DevTrack"
        className="absolute inset-0 z-10 m-auto h-9 w-fit rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground shadow"
      />
    </LiveKitRoom>
  );
}

function isMicError(error: Error): boolean {
  return /NotReadable|NotAllowed|NotFound|audio source|Permission|device/i.test(`${error.name} ${error.message}`);
}

function micMessage(error?: Error): string {
  const text = error ? `${error.name} ${error.message}` : "";
  if (/NotAllowed|Permission/i.test(text)) {
    return "Microphone access is blocked for this site. Allow it in the address bar, then tap the mic.";
  }
  if (/NotFound/i.test(text)) {
    return "No microphone found. Plug one in or pick one in Windows sound settings, then tap the mic.";
  }
  return "Your microphone is busy or unavailable. Close other apps or tabs using it (Zoom, Teams, another call), then tap the mic. You can still type below.";
}

function CallStage({
  onEnd,
  micProblem,
  onMicRetry,
  onMicError,
}: {
  onEnd: () => void;
  micProblem: string | null;
  onMicRetry: () => void;
  onMicError: (error: Error) => void;
}) {
  const { state, audioTrack, videoTrack, agent } = useVoiceAssistant();
  const connection = useConnectionState();

  // If no agent joins soon after we connect, say so instead of waiting
  // forever (the voice worker is offline or still starting).
  const [agentLate, setAgentLate] = useState(false);
  useEffect(() => {
    if (agent || connection !== ConnectionState.Connected) {
      setAgentLate(false);
      return;
    }
    const timer = setTimeout(() => setAgentLate(true), 15000);
    return () => clearTimeout(timer);
  }, [agent, connection]);

  return (
    <div className="flex flex-col gap-3 border-b bg-muted/40 px-3 py-3">
      {videoTrack ? (
        // Avatar video (e.g. Synthesia), when the worker runs one.
        <VideoTrack trackRef={videoTrack} className="aspect-video w-full rounded-lg bg-black object-cover" />
      ) : (
        <div className="flex h-16 items-center justify-center">
          <BarVisualizer
            state={state}
            trackRef={audioTrack}
            barCount={7}
            options={{ minHeight: 12 }}
            className="devtrack-voice-bars flex h-full items-center gap-1.5"
          />
        </div>
      )}
      {agentLate && (
        <p role="alert" className="rounded-md bg-warning-fill/10 px-2 py-1.5 text-xs text-warning">
          The voice agent hasn't joined yet. It may still be starting, or the
          voice worker isn't running (start it with: bun run dev:voice). You can
          keep waiting, or type below.
        </p>
      )}
      {micProblem && (
        <p role="alert" className="flex items-start gap-1.5 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
          <MicOff className="mt-0.5 size-3.5 shrink-0" />
          {micProblem}
        </p>
      )}
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {STATE_LABEL[state] ?? state}
        </span>
        <TrackToggle
          source={Track.Source.Microphone}
          className="inline-flex size-8 items-center justify-center rounded-lg border bg-background text-foreground transition-colors hover:bg-accent data-[lk-enabled=false]:bg-destructive/10 data-[lk-enabled=false]:text-destructive [&>svg]:size-4"
          aria-label="Mute or unmute microphone"
          onChange={(enabled) => {
            if (enabled) onMicRetry();
          }}
          onDeviceError={onMicError}
        />
        <TrackToggle
          source={Track.Source.ScreenShare}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border bg-background px-2 text-xs text-foreground transition-colors hover:bg-accent data-[lk-enabled=true]:border-primary data-[lk-enabled=true]:text-brand [&>svg]:size-4"
          aria-label="Share your screen with the agent"
        >
          Share screen
        </TrackToggle>
        <Button
          type="button"
          size="icon"
          variant="destructive"
          className="size-8 rounded-lg"
          aria-label="End call"
          onClick={onEnd}
        >
          <PhoneOff className="size-4" />
        </Button>
      </div>
    </div>
  );
}
