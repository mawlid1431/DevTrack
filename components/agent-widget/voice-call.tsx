"use client";

import {
  BarVisualizer,
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
  TrackToggle,
  VideoTrack,
  useVoiceAssistant,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { PhoneOff } from "lucide-react";
import { Button } from "@/components/ui/button";

export type VoiceCallSession = { serverUrl: string; token: string; roomName: string };

const STATE_LABEL: Record<string, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting…",
  initializing: "Getting ready…",
  "pre-connect-buffering": "Getting ready…",
  idle: "Waiting for the agent…",
  listening: "Listening — just talk",
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
        onError(error.message || "The call dropped.");
        onEnd();
      }}
      onMediaDeviceFailure={() =>
        onError("Microphone blocked. Allow microphone access for this site, then start the call again.")
      }
      className="relative"
    >
      <CallStage onEnd={onEnd} />
      <RoomAudioRenderer />
      <StartAudio
        label="Tap to hear DevTrack"
        className="absolute inset-0 z-10 m-auto h-9 w-fit rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground shadow"
      />
    </LiveKitRoom>
  );
}

function CallStage({ onEnd }: { onEnd: () => void }) {
  const { state, audioTrack, videoTrack } = useVoiceAssistant();

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
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {STATE_LABEL[state] ?? state}
        </span>
        <TrackToggle
          source={Track.Source.Microphone}
          className="inline-flex size-8 items-center justify-center rounded-lg border bg-background text-foreground transition-colors hover:bg-accent data-[lk-enabled=false]:bg-destructive/10 data-[lk-enabled=false]:text-destructive [&>svg]:size-4"
          aria-label="Mute or unmute microphone"
        />
        <TrackToggle
          source={Track.Source.ScreenShare}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border bg-background px-2 text-xs text-foreground transition-colors hover:bg-accent data-[lk-enabled=true]:border-primary data-[lk-enabled=true]:text-primary [&>svg]:size-4"
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
