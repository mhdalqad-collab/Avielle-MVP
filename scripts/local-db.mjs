// Development only: PostgreSQL engine in a local WASM process. Never a hosted database.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { mkdir } from 'node:fs/promises';
await mkdir('.local',{recursive:true});
const db = await PGlite.create('.local/database');
const server = new PGLiteSocketServer({db,host:'127.0.0.1',port:55432});
await server.start();
console.log('Local development database listening on 127.0.0.1:55432');
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,async()=>{await server.stop();await db.close();process.exit(0);});
