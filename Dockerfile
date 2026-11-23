FROM node:20-alpine

WORKDIR /usr/src/app

# Install dependencies directly without needing package.json
RUN npm init -y && npm install express socket.io --omit=dev

# Copy your server code
COPY server.js .

EXPOSE 3000

CMD ["node", "server.js"]
