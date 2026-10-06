# Build from the repository root: the image needs db/ as well as this folder.
#   docker build -f pipelines/avito/Dockerfile .
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

COPY pipelines/avito/requirements.txt pipelines/avito/requirements.txt
RUN pip install -r pipelines/avito/requirements.txt

COPY db db
COPY pipelines/avito pipelines/avito

RUN useradd --create-home app
USER app
WORKDIR /app/pipelines/avito

CMD ["python", "pipeline.py"]
