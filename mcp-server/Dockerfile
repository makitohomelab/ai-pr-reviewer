FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy built files
COPY dist/ ./dist/

# Create data directory
RUN mkdir -p /data

ENV DATABASE_PATH=/data/memory.db
ENV NODE_ENV=production

EXPOSE 3100

CMD ["node", "dist/index.js", "--http"]
