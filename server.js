const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const readline = require('readline');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["ngrok-skip-browser-warning"],
    credentials: true
  }
});

app.get('/', (req, res) => {
  res.send('PlayCanvas Socket.io Server Running!');
});

const players = {};
let currentMap = 'Map1';

function findPlayer(identifier) {
  if (!identifier) return null;
  if (players[identifier]) return players[identifier];

  const lower = identifier.toLowerCase();
  for (const id in players) {
    if (players[id].username && players[id].username.toLowerCase() === lower) {
      return players[id];
    }
  }
  return null;
}

function switchMap(mapName) {
  currentMap = mapName;
  console.log(`\n[Server] Map changed to: ${currentMap}`);

  Object.keys(players).forEach(id => {
    players[id].health = players[id].maxHealth || 100;
    players[id].position = { x: 0, y: 2, z: 0 };
    players[id].velocity = { x: 0, y: 0, z: 0 };
  });

  io.emit('mapChanged', {
    mapName: currentMap,
    players: Object.values(players)
  });
}

io.on('connection', (socket) => {
  const requestedName = socket.handshake.query.username;
  const username = (requestedName && requestedName.trim() !== '') 
    ? requestedName.trim() 
    : `Player_${socket.id.substring(0, 4)}`;

  console.log(`\n[Server] Connected: ${username} (${socket.id})`);

  players[socket.id] = {
    id: socket.id,
    username: username,
    health: 100,
    maxHealth: 100,
    position: { x: 0, y: 2, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    velocity: { x: 0, y: 0, z: 0 },
    isShooting: false
  };

  socket.emit('init', {
    selfId: socket.id,
    players: Object.values(players),
    currentMap: currentMap
  });

  socket.broadcast.emit('playerJoined', players[socket.id]);

  socket.on('requestMapChange', (data) => {
    if (data && data.mapName) {
      switchMap(data.mapName);
    }
  });

  socket.on('playerUpdate', (data) => {
    if (!players[socket.id]) return;

    players[socket.id].position = data.position;
    players[socket.id].rotation = data.rotation;
    players[socket.id].velocity = data.velocity;
    players[socket.id].isShooting = data.isShooting;

    socket.broadcast.emit('playerMoved', {
      id: socket.id,
      username: players[socket.id].username,
      position: data.position,
      rotation: data.rotation,
      velocity: data.velocity,
      isShooting: data.isShooting
    });
  });

  socket.on('playerFire', (data) => {
    socket.broadcast.emit('remotePlayerFired', {
      id: socket.id,
      hasHit: data.hasHit,
      hitPoint: data.hitPoint,
      normal: data.normal
    });
  });

  socket.on('playerReload', () => {
    socket.broadcast.emit('remotePlayerReloaded', {
      id: socket.id
    });
  });

  socket.on('playSound', (data) => {
    const rawPos = data.pos || data.position || (players[socket.id] ? players[socket.id].position : null);

    const soundPayload = {
      id: socket.id,
      type: data.type || data.sound || 'shoot',
      pos: rawPos
    };

    socket.broadcast.emit('remotePlaySound', soundPayload);
    socket.broadcast.emit('remotePlayerSound', soundPayload);
  });

  socket.on('playerHit', (data) => {
    const targetSocketId = data.targetId;
    const target = players[targetSocketId];

    if (target && target.health > 0) {
      const damage = data.damage || 25;
      target.health = Math.max(0, target.health - damage);

      io.to(targetSocketId).emit('takeDamage', {
        attackerId: socket.id,
        damage: damage,
        currentHealth: target.health,
        hitPoint: data.hitPoint,
        normal: data.normal
      });

      socket.emit('hitConfirmed', {
        targetId: targetSocketId,
        damage: damage,
        isKill: target.health === 0
      });

      socket.broadcast.emit('remotePlayerHit', {
        targetId: targetSocketId,
        attackerId: socket.id,
        hitPoint: data.hitPoint,
        normal: data.normal
      });

      if (target.health === 0) {
        const killerName = players[socket.id] ? players[socket.id].username : 'Unknown';

        io.emit('playerKilled', {
          victimId: targetSocketId,
          victimName: target.username,
          killerId: socket.id,
          killerName: killerName
        });
      }
    }
  });

  socket.on('requestRespawn', () => {
    if (players[socket.id]) {
      const maxHp = players[socket.id].maxHealth || 100;
      players[socket.id].health = maxHp;

      socket.emit('respawnApproved', {
        health: maxHp
      });

      socket.broadcast.emit('remotePlayerRespawned', {
        id: socket.id,
        health: maxHp
      });
    }
  });

  socket.on('disconnect', () => {
    if (players[socket.id]) {
      console.log(`\n[Server] Disconnected: ${players[socket.id].username} (${socket.id})`);
      const leavingUser = players[socket.id].username;
      delete players[socket.id];
      io.emit('playerLeft', { id: socket.id, username: leavingUser });
    }
  });
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: 'SERVER > '
});

rl.prompt();

rl.on('line', (line) => {
  const input = line.trim();
  if (!input) {
    rl.prompt();
    return;
  }

  const parts = input.split(' ');
  const command = parts[0].toLowerCase();
  const args = parts.slice(1);

  switch (command) {
    case 'help':
      console.log('\n--- Console Commands ---');
      console.log('  list                 - List connected players');
      console.log('  map <mapName>        - Switch active map (e.g. map Map1)');
      console.log('  kill <user|id>       - Eliminate a player');
      console.log('  kick <user|id>       - Disconnect a player');
      break;

    case 'list': {
      const active = Object.values(players);
      console.log(`\nConnected Players (${active.length}) | Current Map: ${currentMap}`);
      active.forEach(p => console.log(` - ${p.username} (${p.id}) [HP: ${p.health}]`));
      break;
    }

    case 'map': {
      if (!args.length) {
        console.log(`Current map: ${currentMap}`);
        break;
      }
      switchMap(args[0]);
      break;
    }

    case 'kill': {
      if (!args.length) break;
      const target = findPlayer(args.join(' '));
      if (!target) break;

      target.health = 0;
      io.to(target.id).emit('takeDamage', { attackerId: 'CONSOLE', damage: 100, currentHealth: 0 });
      io.emit('playerKilled', {
        victimId: target.id,
        victimName: target.username,
        killerId: 'SERVER_CONSOLE',
        killerName: 'Server Console'
      });
      break;
    }

    case 'kick': {
      if (!args.length) break;
      const target = findPlayer(args.join(' '));
      if (!target) break;

      const targetSocket = io.sockets.sockets.get(target.id);
      if (targetSocket) targetSocket.disconnect(true);
      break;
    }
  }

  rl.prompt();
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] Listening on http://0.0.0.0:${PORT}`);
  rl.prompt();
});
