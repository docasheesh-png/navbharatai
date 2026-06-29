FROM node:22

WORKDIR /app

COPY package*.json ./

# P-BRE.13 — `npm ci` (not `npm install`) for a reproducible, lockfile-exact install:
# installs strictly from package-lock.json and fails fast if the lock is out of sync.
RUN npm ci

COPY . .

RUN npm run build

ENV PORT=8080

EXPOSE 8080

CMD ["npm","start"]
