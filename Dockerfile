FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY build/ ./build/
EXPOSE 8000
ENV TRANSPORT=sse
CMD ["node", "build/index.js"]
