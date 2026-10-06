// Starts a real PostgreSQL 16 process for isolated development tests on loopback.
import EmbeddedPostgres from 'embedded-postgres';
import { mkdir, access } from 'node:fs/promises';
await mkdir('.local', { recursive: true });
const database = new EmbeddedPostgres({databaseDir:'.local/postgres-test',user:'postgres',password:'local-test-only',port:55433,persistent:true,initdbFlags:['--encoding=UTF8']});
// A persistent cluster must be reused across development sessions.
try { await access('.local/postgres-test/PG_VERSION'); }
catch { await database.initialise(); }
await database.start();
const client=database.getPgClient(); await client.connect();
for(const name of ['avielle_test','avielle_e2e']) {
  if(!(await client.query('SELECT 1 FROM pg_database WHERE datname=$1',[name])).rowCount) await client.query(`CREATE DATABASE ${name}`);
}
await client.end();
console.log('PostgreSQL 16 test databases available on 127.0.0.1:55433');
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,async()=>{await database.stop();process.exit(0);});
setInterval(()=>{},60_000);
