FROM node:20-alpine

WORKDIR /app

# Copiar dependencias
COPY package.json ./
RUN npm install --production

# Copiar código
COPY . .

# Puerto
EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"

CMD ["node", "src/index.js"]
