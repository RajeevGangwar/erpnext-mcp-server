FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
COPY src/ ./src/
RUN npm ci --ignore-scripts && npm run build

FROM node:20-slim
RUN addgroup --system app && adduser --system --ingroup app app
WORKDIR /app
COPY package*.json ./
RUN npm ci --production --ignore-scripts
COPY --from=builder /app/build/ ./build/
RUN chown -R app:app /app
USER app
EXPOSE 8000
ENV TRANSPORT=http
CMD ["node", "build/index.js"]
