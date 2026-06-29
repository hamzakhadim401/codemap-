# Visual Codebase Mapping Platform
# Multi-stage build: keeps the final image lean by separating build tools
# from the runtime.
#
# Build:
#   docker build -t codemap .
#
# Run (SQLite, no auth):
#   docker run -p 8000:8000 codemap
#
# Run (PostgreSQL + API key):
#   docker run -p 8000:8000 \
#     -e DATABASE_URL=postgresql://user:pass@db:5432/codemap \
#     -e CODEMAP_API_KEY=changeme \
#     codemap
#
# For the full stack (server + Postgres), use docker-compose instead.

FROM python:3.13-slim AS base

WORKDIR /app

# Install system dependencies needed by tree-sitter and psycopg2
RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc \
        libpq-dev \
        git \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies (excluding optional torch/tf)
COPY requirements.txt .
RUN pip install --no-cache-dir \
        tree-sitter>=0.22.0 \
        tree-sitter-javascript>=0.22.0 \
        tree-sitter-typescript>=0.22.0 \
        psycopg2-binary>=2.9.9

# Copy application source
COPY engine/    engine/
COPY frontend/  frontend/
COPY server.py  .
COPY cli.py     .

# outputs/ volume mount point for CLI-generated HTML files
RUN mkdir -p outputs

# Default environment
ENV CODEMAP_HOST=0.0.0.0
ENV CODEMAP_PORT=8000

EXPOSE 8000

CMD ["python", "server.py", "--host", "0.0.0.0", "--port", "8000"]
