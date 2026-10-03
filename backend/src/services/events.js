const clients = new Set();

function addClient(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  res.write(': connected\n\n');
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

// Heartbeat to prevent proxies/timeouts
setInterval(() => {
  for (const client of clients) {
    client.write(': heartbeat\n\n');
  }
}, 25000);

module.exports = {
  addClient,
  broadcastStock,
  broadcastStockBatch,
  getClientCount: () => clients.size,
};
