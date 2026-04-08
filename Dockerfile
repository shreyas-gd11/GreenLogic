FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip python-is-python3 \
  && rm -rf /var/lib/apt/lists/*

COPY . .

RUN python -m pip install --no-cache-dir -r requirements.txt

ENV HOST=0.0.0.0
ENV PORT=7860

EXPOSE 7860

CMD ["node", "server.js"]
