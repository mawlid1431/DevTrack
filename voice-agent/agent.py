"""DevTrack voice agent — a LiveKit worker you can talk to.

The browser's floating "DevTrack AI" panel starts a call: Convex mints a
LiveKit token that dispatches this worker (AGENT_NAME) into a fresh room.

  - Speech-to-text, the voice LLM and text-to-speech run on LiveKit Cloud
    inference (billed to the LiveKit project in .env.local).
  - Every workspace question or action goes through ONE tool, `workspace`,
    which POSTs to Convex `/voice-agent/turn`. Convex runs the same DevTrack
    agent + tools as text chat (create/update/delete issues and projects,
    reports, templates, navigateTo to move the user's screen...), as the user
    who started the call, in their workspace only. Auth: AGENT_SHARED_SECRET.
  - If the user shares their screen, the voice LLM can see it.
  - Optional Synthesia avatar when SYNTHESIA_API_KEY is set (falls back to
    voice-only if the avatar can't start).

Run locally:  python agent.py dev
"""

import asyncio
import logging
import os
from pathlib import Path

import aiohttp
from dotenv import load_dotenv
from livekit.agents import (
    Agent,
    AgentSession,
    JobContext,
    RunContext,
    ToolError,
    WorkerOptions,
    cli,
    function_tool,
    inference,
    room_io,
)
from livekit.plugins import silero

from instructions import GREETING, INSTRUCTIONS

# The app's .env.local holds every key, so the worker reads the same file.
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env.local")

logger = logging.getLogger("devtrack-voice")

# Must match DEVTRACK_VOICE_AGENT_NAME in convex/agent/voiceToken.ts.
AGENT_NAME = os.getenv("DEVTRACK_VOICE_AGENT_NAME", "devtrack-voice")
CONVEX_SITE_URL = os.getenv("NEXT_PUBLIC_CONVEX_SITE_URL", "").rstrip("/")
AGENT_SHARED_SECRET = os.getenv("AGENT_SHARED_SECRET", "")
LLM_MODEL = os.getenv("DEVTRACK_VOICE_LLM", "openai/gpt-4.1-mini")
STT_MODEL = os.getenv("DEVTRACK_VOICE_STT", "cartesia/ink-2")
TTS_MODEL = os.getenv("DEVTRACK_VOICE_TTS", "cartesia/sonic-3.6")
TTS_VOICE = os.getenv("DEVTRACK_VOICE_ID", "db6b0ed5-d5d3-463d-ae85-518a07d3c2b4")
AVATAR_MODE = os.getenv("DEVTRACK_AVATAR", "synthesia" if os.getenv("SYNTHESIA_API_KEY") else "off")
AVATAR_ID = os.getenv("SYNTHESIA_AVATAR_ID", "4b638067-6319-46e1-b634-371a4bdfceb9")


class DevTrackVoice(Agent):
    def __init__(self, room_name: str, http: aiohttp.ClientSession) -> None:
        super().__init__(instructions=INSTRUCTIONS)
        self._room_name = room_name
        self._http = http

    @function_tool
    async def workspace(self, context: RunContext, request: str) -> str:
        """Do or answer anything about the user's DevTrack workspace, immediately.

        Use for every question or action about issues, projects, cycles,
        teams, members, templates, the recycle bin, reports and standups, and
        for opening/showing any page on the user's screen.

        Args:
            request: The user's request in their own words, with any details
                they gave (titles, team, priority, who, which page). Include
                what you can see on their shared screen if it matters.
        """
        if not CONVEX_SITE_URL or not AGENT_SHARED_SECRET:
            raise ToolError("The workspace connection isn't configured.")
        try:
            async with self._http.post(
                f"{CONVEX_SITE_URL}/voice-agent/turn",
                json={"roomName": self._room_name, "text": request},
                headers={"Authorization": f"Bearer {AGENT_SHARED_SECRET}"},
                timeout=aiohttp.ClientTimeout(total=60),
            ) as res:
                body = await res.json(content_type=None)
        except (aiohttp.ClientError, asyncio.TimeoutError) as e:
            logger.warning("workspace call failed: %s", e)
            raise ToolError("DevTrack didn't respond. Try again in a moment.") from e
        if res.status != 200:
            raise ToolError(body.get("error", "The request failed."))
        return body.get("reply", "Done.")


def prewarm(proc) -> None:
    proc.userdata["vad"] = silero.VAD.load()


async def start_avatar(session: AgentSession, ctx: JobContext) -> None:
    if AVATAR_MODE != "synthesia":
        return
    try:
        from livekit.plugins import synthesia

        avatar = synthesia.AvatarSession(
            synthesia.AvatarConfig(avatar_ids=[AVATAR_ID]),
            join_timeout=60.0,
        )
        await avatar.start(session, room=ctx.room)
    except Exception as e:  # noqa: BLE001 — avatar is optional
        logger.warning("Avatar unavailable, continuing voice-only: %s", e)


async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect()
    http = aiohttp.ClientSession()
    ctx.add_shutdown_callback(http.close)

    session = AgentSession(
        stt=inference.STT(model=STT_MODEL),
        llm=inference.LLM(model=LLM_MODEL),
        tts=inference.TTS(model=TTS_MODEL, voice=TTS_VOICE),
        vad=ctx.proc.userdata["vad"],
        max_tool_steps=4,
        turn_handling={
            "turn_detection": "stt",
            # Off: a speculative reply from a half-heard sentence could change data.
            "preemptive_generation": {"enabled": False},
            "interruption": {"min_duration": 0.6, "min_words": 1, "false_interruption_timeout": 2.0},
        },
    )

    await start_avatar(session, ctx)

    await session.start(
        agent=DevTrackVoice(room_name=ctx.room.name, http=http),
        room=ctx.room,
        # Lets the agent see the user's shared screen.
        room_options=room_io.RoomOptions(video_input=True),
    )
    session.generate_reply(instructions=GREETING)


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(entrypoint_fnc=entrypoint, prewarm_fnc=prewarm, agent_name=AGENT_NAME)
    )
