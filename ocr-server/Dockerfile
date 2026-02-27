# EZSplit OCR server — runs on cloud for public/multi-user use
FROM node:20-slim

WORKDIR /app

# Install deps (Tesseract not required in image; we use tesseract.js which uses WASM)
COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js ./

EXPOSE 3080
ENV PORT=3080
CMD ["node", "server.js"]
