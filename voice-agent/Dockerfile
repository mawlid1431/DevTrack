# DevTrack voice worker for LiveKit Cloud (`lk agent create` / `lk agent deploy`).
# Secrets (set on LiveKit Cloud, never baked in): AGENT_SHARED_SECRET,
# NEXT_PUBLIC_CONVEX_SITE_URL. LIVEKIT_* are provided by LiveKit Cloud.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY agent.py instructions.py ./

# Bake the Silero VAD model into the image so cold starts don't download it.
RUN python agent.py download-files

CMD ["python", "agent.py", "start"]
