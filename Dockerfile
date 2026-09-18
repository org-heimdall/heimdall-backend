FROM node:24-slim
WORKDIR /app
COPY package.json ./
COPY node_modules ./node_modules
COPY dist ./dist
EXPOSE 3000
CMD ["node", "dist/main.js"]
