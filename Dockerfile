FROM python:3.13-slim

WORKDIR /app
ENV HOST=0.0.0.0
ENV PORT=5404
ENV PYTHONUNBUFFERED=1

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY public ./public

EXPOSE 5404
CMD ["sh", "-c", "uvicorn app.main:app --host ${HOST:-0.0.0.0} --port ${PORT:-5404}"]
