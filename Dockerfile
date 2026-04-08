FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
COPY src/ ./src/
RUN npm ci --ignore-scripts && npm run build

FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --production --ignore-scripts
COPY --from=builder /app/build/ ./build/
EXPOSE 8000
ENV TRANSPORT=sse
CMD ["node", "build/index.js"]
