FROM python:3.12-slim

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install python requirements
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r ./backend/requirements.txt

# Copy backend source code, server entrypoint, and lunar assets
COPY backend/ ./backend/
COPY assets/ ./assets/
COPY server.py ./server.py

# Expose port 8000 for FastAPI / WebSockets
EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1

CMD ["python", "server.py", "--host", "0.0.0.0", "--port", "8000", "--no-reload"]
