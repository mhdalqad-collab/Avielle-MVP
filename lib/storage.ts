import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { mkdir,readFile,writeFile,unlink } from "node:fs/promises";
import path from "node:path";
import { HttpError } from "./http";
const localRoot=path.join(process.cwd(),".local","uploads");
function local() { return process.env.NODE_ENV!=="production" && process.env.STORAGE_DRIVER==="local"; }
function s3() {
  if (!process.env.S3_BUCKET || !process.env.S3_ACCESS_KEY_ID || !process.env.S3_SECRET_ACCESS_KEY) throw new HttpError(503,"Photo uploads are not available yet. Please try again later.");
  return new S3Client({region:process.env.S3_REGION||"auto",endpoint:process.env.S3_ENDPOINT||undefined,forcePathStyle:process.env.S3_FORCE_PATH_STYLE==="true",credentials:{accessKeyId:process.env.S3_ACCESS_KEY_ID,secretAccessKey:process.env.S3_SECRET_ACCESS_KEY}});
}
export async function storeImage(bytes:Buffer) {
  const key=`${randomUUID()}.webp`;
  if(local()) {await mkdir(localRoot,{recursive:true}); await writeFile(path.join(localRoot,key),bytes);}
  else await s3().send(new PutObjectCommand({Bucket:process.env.S3_BUCKET,Key:key,Body:bytes,ContentType:"image/webp"}));
  return key;
}
export async function fetchImage(key:string) {
  if(!/^[a-f0-9-]{36}\.webp$/.test(key)) throw new HttpError(404,"Photo not found.");
  if(local()) return readFile(path.join(localRoot,key));
  const result=await s3().send(new GetObjectCommand({Bucket:process.env.S3_BUCKET,Key:key}));
  if(!result.Body) throw new HttpError(404,"Photo not found.");
  return Buffer.from(await result.Body.transformToByteArray());
}
export async function removeImage(key:string) {
  if(!/^[a-f0-9-]{36}\.webp$/.test(key)) return;
  if(local()) await unlink(path.join(localRoot,key));
  else await s3().send(new DeleteObjectCommand({Bucket:process.env.S3_BUCKET,Key:key}));
}
