# Sử dụng base image chính thức của Bun
FROM oven/bun:1-alpine as base
WORKDIR /app

# Install dependencies (cache layer này riêng để build nhanh hơn)
COPY package.json ./
RUN bun install --production

# Copy source code
COPY src ./src

# Expose port (Hono mặc định chạy 3000)
EXPOSE 3000

# Chạy server
CMD ["bun", "src/index.ts"]
