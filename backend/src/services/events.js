const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/env');
const userRepository = require('../repositories/userRepository');

const clients = new Set();

async function addClient(req, res) {
  let token = req.query.token;
  if (
    !token &&
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer ')
  ) {
    token = req.headers.authorization.split(' ')[1];
  }

  let user = null;
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded && decoded.id) {
        const dbUser = await userRepository.findById(decoded.id);
        if (dbUser && dbUser.status !== 'suspended') {
          user = { id: String(dbUser.id), role: dbUser.role };
        }
      }
    } catch (e) {
      // ignore invalid tokens
    }
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  res.write(': connected\n\n');
  res.user = user;
  clients.add(res);

  req.on('close', () => {
    clients.delete(res);
  });
}

function broadcastStock(productId, stock, isAvailable) {
  const payload = JSON.stringify({
    productId: String(productId),
    stock: Number(stock),
    isAvailable: Boolean(isAvailable),
  });

  for (const client of clients) {
    client.write(`event: stock\ndata: ${payload}\n\n`);
  }
}

function broadcastStockBatch(items) {
  for (const item of items) {
    broadcastStock(item.productId, item.stock, item.isAvailable);
  }
}

function sendToUser(userId, eventName, data) {
  const targetId = String(userId);
  const payload = JSON.stringify(data);

  for (const client of clients) {
    if (client.user && String(client.user.id) === targetId) {
      client.write(`event: ${eventName}\ndata: ${payload}\n\n`);
    }
  }
}

function sendToAdmins(eventName, data) {
  const payload = JSON.stringify(data);

  for (const client of clients) {
    if (client.user && client.user.role === 'admin') {
      client.write(`event: ${eventName}\ndata: ${payload}\n\n`);
    }
  }
}

function broadcastAll(eventName, data) {
  const payload = JSON.stringify(data);

  for (const client of clients) {
    client.write(`event: ${eventName}\ndata: ${payload}\n\n`);
  }
}

// Heartbeat to prevent proxies/timeouts
const heartbeatTimer = setInterval(() => {
  for (const client of clients) {
    client.write(': heartbeat\n\n');
  }
}, 25000);
if (heartbeatTimer && heartbeatTimer.unref) {
  heartbeatTimer.unref();
}

module.exports = {
  addClient,
  broadcastStock,
  broadcastStockBatch,
  sendToUser,
  sendToAdmins,
  broadcastAll,
  getClientCount: () => clients.size,
};
