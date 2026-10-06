// TEST RUNNER ONLY. Never imported by application code, build or production startup.
// Intercepts the email provider boundary while real HTTP/account/database flows run.
const fs=require('node:fs');
const path=require('node:path');
const target=new URL(process.env.DATABASE_URL || 'http://invalid');
if(process.env.AVIELLE_E2E !== '1' || !['127.0.0.1','localhost'].includes(target.hostname) || !target.pathname.endsWith('_e2e') || process.env.NODE_ENV === 'production') throw new Error('Email test harness requires an isolated local e2e database and nonproduction server');
const realFetch=globalThis.fetch;
globalThis.fetch=async function(input,options){
  const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
  if(url==='https://api.resend.com/emails'){
    const email=JSON.parse(options.body);
    const folder=path.join(process.cwd(),'.local','e2e-mail'); fs.mkdirSync(folder,{recursive:true});
    fs.writeFileSync(path.join(folder,Buffer.from(email.to[0]).toString('hex')+'.json'),JSON.stringify(email));
    return new Response(JSON.stringify({id:'test-delivery-only'}),{status:200,headers:{'content-type':'application/json'}});
  }
  return realFetch(input,options);
};
