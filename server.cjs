const http = require('node:http');
const next = require('next');
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
const app = next({ dev: false, hostname: '0.0.0.0', port });
app.prepare().then(() => {
  const server = http.createServer(app.getRequestHandler());
  server.listen(port, '0.0.0.0', () => console.log(`Avielle listening on port ${port}`));
  for (const signal of ['SIGTERM','SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
}).catch(() => { console.error('Avielle could not start. Check build and environment configuration.'); process.exit(1); });
