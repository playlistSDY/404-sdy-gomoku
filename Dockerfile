FROM python:3.13-slim AS native-builder

WORKDIR /build
COPY native ./native
RUN apt-get update \
    && apt-get install -y --no-install-recommends g++ \
    && g++ -O3 -std=c++20 -static-libstdc++ -static-libgcc native/gomoku_alpha_beta.cpp -o /gomoku_alpha_beta \
    && rm -rf /var/lib/apt/lists/*

FROM python:3.13-slim

WORKDIR /app
ENV HOST=0.0.0.0
ENV PORT=5404
ENV PYTHONUNBUFFERED=1

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY public ./public
COPY --from=native-builder /gomoku_alpha_beta /usr/local/bin/gomoku_alpha_beta

EXPOSE 5404
CMD ["sh", "-c", "uvicorn app.main:app --host ${HOST:-0.0.0.0} --port ${PORT:-5404}"]
