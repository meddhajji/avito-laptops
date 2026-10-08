# Build from the repository root: the image needs db/ as well as this folder.
#   docker build -f pipeline/Dockerfile .
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

COPY pipeline/requirements.txt pipeline/requirements.txt
RUN pip install -r pipeline/requirements.txt

COPY db db
COPY pipeline pipeline

RUN useradd --create-home app
USER app
WORKDIR /app/pipeline

CMD ["python", "pipeline.py"]
