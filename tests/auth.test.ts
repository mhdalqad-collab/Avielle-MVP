import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword,verifyPassword,hashToken,newToken } from "../lib/password";
import { assertSameOrigin,readJson,readBody,HttpError } from "../lib/http";
test("password hashes are salted and reject wrong passwords",async()=>{
  const first=await hashPassword("correct horse battery staple");
  const second=await hashPassword("correct horse battery staple");
  assert.notEqual(first,second);
  assert.equal(await verifyPassword("correct horse battery staple",first),true);
  assert.equal(await verifyPassword("incorrect",first),false);
  assert.equal(await verifyPassword("incorrect","invalid"),false);
});
test("session tokens have independent entropy and are stored as hashes",()=>{
  const first=newToken(),second=newToken();
  assert.notEqual(first,second);assert.equal(hashToken(first).length,64);assert.notEqual(hashToken(first),first);
});
test("mutations reject missing and attacker origins",()=>{
  process.env.APP_URL="http://localhost:3000";
  assert.throws(()=>assertSameOrigin(new Request("http://localhost:3000/api/auth")),(e:unknown)=>e instanceof HttpError && e.status===403);
  assert.throws(()=>assertSameOrigin(new Request("http://localhost:3000/api/auth",{headers:{origin:"https://attacker.example"}})),/did not come/);
  assert.doesNotThrow(()=>assertSameOrigin(new Request("http://localhost:3000/api/auth",{headers:{origin:"http://localhost:3000"}})));
});
test("request body limit cannot be bypassed without content-length",async()=>{
  const request=new Request("http://localhost:3000/api/auth",{method:"POST",body:"a".repeat(200)});
  await assert.rejects(()=>readBody(request,100),(e:unknown)=>e instanceof HttpError && e.status===413);
});
test("JSON endpoint rejects incorrect MIME and malformed bodies",async()=>{
  await assert.rejects(()=>readJson(new Request("http://localhost:3000/api/auth",{method:"POST",body:"{}"})),(e:unknown)=>e instanceof HttpError && e.status===415);
  await assert.rejects(()=>readJson(new Request("http://localhost:3000/api/auth",{method:"POST",headers:{"content-type":"application/json"},body:"["})),(e:unknown)=>e instanceof HttpError && e.status===400);
});
