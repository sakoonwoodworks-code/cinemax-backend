# CineMax Production Cloud Server Dockerfile
FROM node:20-alpine AS build

# Install build dependencies for better-sqlite3 (python, make, g++)
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

# Ensure data directory exists
RUN mkdir -p /app/data

EXPOSE 8080

ENV NODE_ENV=production
ENV PORT=8080

CMD ["node", "src/server.js"]
