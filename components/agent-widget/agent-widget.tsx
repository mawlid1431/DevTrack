"use client";

import { optimisticallySendMessage } from "@convex-dev/agent/react";
import { useAction, useMutation } from "convex/react";
import {
  Maximize2,
  PhoneOff,
  Phone,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AiComposer } from "@/components/ai/composer";
import { convexErrorMessage } from "@/components/ai/convex-error";
import { AiConversation } from "@/components/ai/conversation";
import { useAiAccess } from "@/components/ai/use-ai-access";
import { cn } from "@/lib/utils";
import { captureScreenContext } from "./screen-guide";
import { describeMicError, type VoiceCallSession } from "./voice-mic";

// LiveKit is browser-only and heavy; load it when a call starts.
const VoiceCall = dynamic(() => import("./voice-call").then((m) => m.VoiceCall), {
  ssr: false,
});

const SUGGESTIONS = [
  "What should I work on next?",
  "Create an issue: login button is broken on mobile",
  "Open the Projects page",
  "Summarize the current cycle",
];

function storageKey(orgSlug: string) {
  return `devtrack:agent-thread:${orgSlug}`;
}
function readThread(orgSlug: string): string | null {
  try {
    return localStorage.getItem(storageKey(orgSlug));
  } catch {
    return null;
  }
}
function writeThread(orgSlug: string, threadId: string | null) {
  try {
    if (threadId) localStorage.setItem(storageKey(orgSlug), threadId);
    else localStorage.removeItem(storageKey(orgSlug));
  } catch {
    // Storage blocked (private mode), the panel still works, just forgets.
  }
}

/**
 * Notion-AI-style floating agent, available on every workspace screen.
 * Bottom-right button (or Ctrl/⌘ + J) opens a panel to type, dictate, or hold
 * a live voice call with the DevTrack agent, which can read and change the
 * workspace and move the user's screen (navigateTo).
 */
export function AgentWidget() {
  const pathname = usePathname();
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const { isLoaded, hasAccess } = useAiAccess();
  const [open, setOpen] = useState(false);
  // A live voice call outlives the panel: closing or minimising it, or moving
  // to any page (the full AI page too), keeps talking. It ends only with the
  // End button, or when the tab/browser closes.
  const [liveCall, setLiveCall] = useState<LiveCall | null>(null);

  // Ctrl/⌘ + J toggles the agent from anywhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The full AI page already is the agent: hide the launcher there, but keep
  // this component mounted so a running call is never cut off.
  const onAiPage = pathname === `/${orgSlug}/ai`;

  return (
    <>
      <section
        role="dialog"
        data-agent-panel
        aria-label="DevTrack AI"
        aria-hidden={!open}
        inert={!open}
        className={cn(
          "fixed z-50 flex flex-col overflow-hidden border bg-background shadow-2xl transition-all duration-200 ease-out motion-reduce:transition-none",
          "inset-x-2 bottom-2 top-14 rounded-xl md:inset-x-auto md:bottom-20 md:right-5 md:top-auto md:h-[min(40rem,calc(100dvh-7rem))] md:w-[26rem]",
          open ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"
        )}
      >
        {isLoaded && hasAccess ? (
          <AgentPanel orgSlug={orgSlug} onClose={() => setOpen(false)} onCallChange={setLiveCall} />
        ) : (
          <LockedPanel orgSlug={orgSlug} onClose={() => setOpen(false)} />
        )}
      </section>

      {liveCall && !open ? (
        <CallBar call={liveCall} onOpen={() => setOpen(true)} />
      ) : null}

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            hidden={onAiPage || (liveCall !== null && !open)}
            onClick={() => setOpen((value) => !value)}
            aria-label={open ? "Close DevTrack AI" : "Open DevTrack AI"}
            data-tour="ai-button"
            aria-expanded={open}
            className={cn(
              "fixed bottom-4 right-4 z-50 flex size-12 items-center justify-center rounded-full border bg-background text-foreground shadow-lg transition-all hover:scale-105 hover:shadow-xl md:bottom-5 md:right-5",
              open && "max-md:hidden"
            )}
          >
            {open ? <X className="size-5" /> : <Sparkles className="size-5 text-brand" />}
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">Ask DevTrack AI (Ctrl+J)</TooltipContent>
      </Tooltip>
    </>
  );
}

function PanelHeader({
  orgSlug,
  onClose,
  onNew,
}: {
  orgSlug: string;
  onClose: () => void;
  onNew?: () => void;
}) {
  return (
    <header className="flex h-11 shrink-0 items-center gap-1 border-b px-3">
      <Sparkles className="size-4 text-brand" />
      <h2 className="ml-1 text-sm font-medium">DevTrack AI</h2>
      <div className="ml-auto flex items-center gap-0.5">
        {onNew && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7" onClick={onNew} aria-label="New chat">
                <Plus className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>New chat</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-7" asChild>
              <Link href={`/${orgSlug}/ai`} aria-label="Open full AI page" onClick={onClose}>
                <Maximize2 className="size-3.5" />
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Open full page</TooltipContent>
        </Tooltip>
        <Button variant="ghost" size="icon" className="size-7" onClick={onClose} aria-label="Close">
          <X className="size-4" />
        </Button>
      </div>
    </header>
  );
}

function LockedPanel({ orgSlug, onClose }: { orgSlug: string; onClose: () => void }) {
  return (
    <>
      <PanelHeader orgSlug={orgSlug} onClose={onClose} />
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <Sparkles className="size-6 text-brand" />
        <p className="text-sm text-muted-foreground">
          The AI agent is part of the Pro and Enterprise plans.
        </p>
        <Button asChild size="sm">
          <Link href={`/${orgSlug}/settings/billing`} onClick={onClose}>
            See plans
          </Link>
        </Button>
      </div>
    </>
  );
}

type LiveCall = { startedAt: number; end: () => void };

/** Shown while a call is live and the panel is closed: timer, reopen, end. */
function CallBar({ call, onOpen }: { call: LiveCall; onOpen: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const secs = Math.max(0, Math.floor((now - call.startedAt) / 1000));
  const time = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  return (
    <div
      role="status"
      aria-label={`On call with DevTrack, ${time}`}
      className="fixed bottom-4 right-4 z-50 flex items-center gap-1 rounded-full border bg-background py-1 pl-1 pr-1 shadow-lg md:bottom-5 md:right-5"
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex h-9 items-center gap-2 rounded-full pl-3 pr-2 text-sm hover:bg-accent"
        aria-label="Open the call"
      >
        <span className="relative flex size-2.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-status-done opacity-60 motion-reduce:animate-none" />
          <span className="relative inline-flex size-2.5 rounded-full bg-status-done" />
        </span>
        <span className="font-medium">On call with DevTrack</span>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">{time}</span>
      </button>
      <Button
        type="button"
        size="icon"
        variant="destructive"
        className="size-9 rounded-full"
        aria-label="End call"
        onClick={call.end}
      >
        <PhoneOff className="size-4" />
      </Button>
    </div>
  );
}

function AgentPanel({
  orgSlug,
  onClose,
  onCallChange,
}: {
  orgSlug: string;
  onClose: () => void;
  onCallChange: (call: LiveCall | null) => void;
}) {
  const [threadId, setThreadIdState] = useState<string | null>(null);
  const [call, setCall] = useState<VoiceCallSession | null>(null);
  const [startingCall, setStartingCall] = useState(false);

  // Tell the widget when a call starts/ends (for the mini call bar).
  const callKey = call?.roomName;
  useEffect(() => {
    onCallChange(callKey ? { startedAt: Date.now(), end: () => setCall(null) } : null);
  }, [callKey, onCallChange]);

  useEffect(() => {
    // restore from browser storage after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setThreadIdState(readThread(orgSlug));
  }, [orgSlug]);

  const setThreadId = (id: string | null) => {
    setThreadIdState(id);
    writeThread(orgSlug, id);
  };

  const createThread = useMutation(api.agent.chat.createThread);
  const startVoiceSession = useMutation(api.agent.voice.startVoiceSession);
  const createVoiceToken = useAction(api.agent.voiceToken.createVoiceToken);
  const updateVoiceScreen = useMutation(api.agent.voice.updateVoiceScreen);

  // During a call, keep the agent's view of the screen fresh (no sharing needed).
  const callRoom = call?.roomName;
  useEffect(() => {
    if (!callRoom) return;
    let last = "";
    const push = () => {
      const screen = captureScreenContext();
      if (screen && screen !== last) {
        last = screen;
        updateVoiceScreen({ roomName: callRoom, screen }).catch(() => undefined);
      }
    };
    push();
    const timer = setInterval(push, 1500);
    return () => clearInterval(timer);
  }, [callRoom, updateVoiceScreen]);
  const sendMessage = useMutation(api.agent.chat.sendMessage).withOptimisticUpdate(
    (store, args) => {
      optimisticallySendMessage(api.agent.chat.listMessages)(store, {
        threadId: args.threadId,
        prompt: args.prompt,
      });
    }
  );

  const send = async (prompt: string) => {
    try {
      let id = threadId;
      if (!id) {
        id = await createThread({});
        setThreadId(id);
      }
      await sendMessage({ threadId: id, prompt, screen: captureScreenContext() });
    } catch (error) {
      // A stale stored thread (deleted elsewhere), start fresh next time.
      if (String(error).includes("Thread not found")) setThreadId(null);
      toast.error(convexErrorMessage(error, "Failed to send message. Please try again."));
      throw error;
    }
  };

  const startCall = async () => {
    setStartingCall(true);
    // iPhone/iPad Safari only grants the microphone during the tap itself,
    // so ask for it FIRST, before any network call. The same track is then
    // published into the call (no second request that iOS would refuse).
    let micTrack: MediaStreamTrack | undefined;
    let micError: string | undefined;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      micTrack = stream.getAudioTracks()[0];
    } catch (error) {
      micError = describeMicError(error);
    }
    try {
      const session = await startVoiceSession({ threadId: threadId ?? undefined });
      setThreadId(session.threadId);
      const token = await createVoiceToken({ roomName: session.roomName });
      if (!token.ok) {
        toast.error(token.reason);
        return;
      }
      setCall({ serverUrl: token.serverUrl, token: token.token, roomName: session.roomName, micTrack, micError });
      micTrack = undefined; // now owned by the call
    } catch (error) {
      toast.error(convexErrorMessage(error, "Couldn't start the call."));
    } finally {
      micTrack?.stop();
      setStartingCall(false);
    }
  };

  return (
    <>
      <PanelHeader
        orgSlug={orgSlug}
        onClose={onClose}
        onNew={call ? undefined : () => setThreadId(null)}
      />

      {call ? (
        <VoiceCall
          session={call}
          onEnd={() => setCall(null)}
          onError={(message) => toast.error(message)}
        />
      ) : (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
          <p className="text-xs text-muted-foreground">Talk to DevTrack hands-free</p>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5"
            disabled={startingCall}
            onClick={() => void startCall()}
          >
            <Phone className="size-3.5" />
            {startingCall ? "Connecting…" : "Start voice call"}
          </Button>
        </div>
      )}

      {threadId ? (
        <AiConversation key={threadId} threadId={threadId} compact />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col justify-end gap-1 overflow-y-auto p-3">
          <p className="px-1 pb-1 text-xs font-medium text-muted-foreground">
            Ask anything, or tell DevTrack what to do
          </p>
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => void send(suggestion).catch(() => undefined)}
              className="flex h-8 items-center rounded-md px-2 text-left text-sm text-foreground/80 transition-colors hover:bg-accent"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      <AiComposer disabled={false} onSend={send} compact />
    </>
  );
}
