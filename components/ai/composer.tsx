"use client";

import { ArrowUp, Mic, Square } from "lucide-react";
import { FormEvent, KeyboardEvent, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useSpeechInput } from "./use-speech-input";

export function AiComposer({
  disabled,
  disabledReason,
  onSend,
}: {
  disabled: boolean;
  disabledReason?: string;
  onSend: (prompt: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const submit = async (value = text) => {
    const prompt = value.trim();
    if (!prompt || disabled || sending) {
      return;
    }
    setSending(true);
    setText("");
    try {
      await onSend(prompt);
    } catch {
      // Caller surfaces the error; restore the draft so nothing is lost.
      setText(prompt);
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  };

  // Voice: the transcript streams into the box, and is sent as soon as the
  // user stops talking — same path as typing + Enter.
  const voice = useSpeechInput({
    onTranscript: setText,
    onDone: (spoken) => void submit(spoken),
    onError: (message) => toast.error(message),
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  const busy = disabled || sending;

  return (
    <div className="px-4 pb-4 pt-2">
      <form
        onSubmit={onSubmit}
        className={cn(
          "mx-auto flex w-full max-w-3xl items-end gap-1.5 rounded-xl border bg-background p-2 shadow-sm transition-shadow focus-within:shadow-md",
          voice.listening && "border-red-400/60 ring-2 ring-red-400/20"
        )}
      >
        <Textarea
          ref={textareaRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            disabled
              ? (disabledReason ?? "AI is unavailable")
              : voice.listening
                ? "Listening… just speak"
                : "Tell DevTrack what to do — type or tap the mic…"
          }
          disabled={busy}
          readOnly={voice.listening}
          rows={1}
          className="max-h-40 min-h-9 flex-1 resize-none border-none bg-transparent px-2 py-1.5 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        {voice.supported && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant={voice.listening ? "destructive" : "ghost"}
                aria-label={voice.listening ? "Stop listening" : "Speak to the agent"}
                aria-pressed={voice.listening}
                className={cn("size-8 shrink-0 rounded-lg", voice.listening && "animate-pulse")}
                disabled={busy}
                onClick={voice.listening ? voice.stop : voice.start}
              >
                {voice.listening ? <Square className="size-3.5" /> : <Mic className="size-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {voice.listening ? "Stop — sends what you said" : "Talk to the agent"}
            </TooltipContent>
          </Tooltip>
        )}
        <Button
          type="submit"
          size="icon"
          aria-label="Send message"
          className="size-8 shrink-0 rounded-lg"
          disabled={busy || voice.listening || !text.trim()}
        >
          <ArrowUp className="size-4" />
        </Button>
      </form>
      <p className="mx-auto mt-1.5 max-w-3xl px-1 text-[0.6875rem] text-muted-foreground">
        DevTrack acts right away on your workspace. Enter to send, Shift+Enter
        for a new line{voice.supported ? ", or use the mic to speak" : ""}.
      </p>
    </div>
  );
}
