import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "./db";
import { appUrl } from "./config";

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function assertSameOrigin(request: Request) {
  if (request.headers.get("origin") !== appUrl()) throw new HttpError(403, "This request did not come from Avielle. Refresh the page and try again.");
  if (request.headers.get("sec-fetch-site") === "cross-site") throw new HttpError(403, "Cross-site request rejected.");
}
export async function readBody(request: Request, maxBytes = 65_536) {
  if (Number(request.headers.get("content-length")) > maxBytes) throw new HttpError(413, "The upload is too large.");
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const {done,value} = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maxBytes) { await reader.cancel(); throw new HttpError(413, "The upload is too large."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
export async function readJson(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new HttpError(415, "Send JSON for this request.");
  try { return JSON.parse((await readBody(request)).toString("utf8")) as unknown; }
  catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, "Invalid request body."); }
}
export const privateHeaders = {"Cache-Control":"private, no-store"};
export function apiError(error: unknown) {
  if (error instanceof HttpError) return Response.json({error:error.message}, {status:error.status,headers:privateHeaders});
  if (error instanceof z.ZodError) return Response.json({error:error.issues.map(i=>`${i.path.join(".")}: ${i.message}`).join("; ")}, {status:400,headers:privateHeaders});
  if (typeof error === "object" && error && "code" in error && error.code === "P2002") return Response.json({error:"This record already exists. Refresh and try again."},{status:409,headers:privateHeaders});
  console.error("API failure", error instanceof Error ? error.name : "UnknownError");
  return Response.json({error:"We could not complete that request. Please try again shortly."},{status:500,headers:privateHeaders});
}
// Persisted counters work across instances; raw keys (including emails) never enter logs.
export async function rateLimit(input: string, limit: number, windowSeconds: number) {
  const key = createHash("sha256").update(input).digest("hex");
  const expiresAt = new Date(Date.now()+windowSeconds*1000);
  const rows = await db.$queryRaw<{count:number}[]>`
    INSERT INTO "RateLimit" ("key","count","expiresAt") VALUES (${key},1,${expiresAt})
    ON CONFLICT ("key") DO UPDATE SET "count" = CASE WHEN "RateLimit"."expiresAt" < NOW() THEN 1 ELSE "RateLimit"."count" + 1 END,
    "expiresAt" = CASE WHEN "RateLimit"."expiresAt" < NOW() THEN ${expiresAt} ELSE "RateLimit"."expiresAt" END RETURNING "count"`;
  if (rows[0].count > limit) throw new HttpError(429, "Too many attempts. Please try again later.");
}
