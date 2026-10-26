import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import {
  readBoundedJsonBody,
  parseBoundedJsonBody,
  readOptionalBoundedJsonBody,
  parseOptionalBoundedJsonBody,
  HttpBodyTooLargeError,
  InvalidJsonBodyError,
} from "../bounded-http-body.js";

function makeRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request("https://example.com/api", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
}

test("readBoundedJsonBody parses valid JSON and returns unknown", async () => {
  const req = makeRequest(JSON.stringify({ hello: "world" }));
  const data = await readBoundedJsonBody(req);
  assert.deepEqual(data, { hello: "world" });
});

test("parseBoundedJsonBody validates against schema", async () => {
  const Schema = z.strictObject({
    name: z.string().min(1),
    count: z.number().int().positive(),
  });
  const req = makeRequest(JSON.stringify({ name: "agent", count: 5 }));
  const parsed = await parseBoundedJsonBody(req, Schema);
  assert.deepEqual(parsed, { name: "agent", count: 5 });

  const invalidReq = makeRequest(JSON.stringify({ name: "agent", count: -1 }));
  await assert.rejects(async () => {
    await parseBoundedJsonBody(invalidReq, Schema);
  }, z.ZodError);
});

test("readBoundedJsonBody enforces byte limits", async () => {
  const largePayload = JSON.stringify({ data: "x".repeat(2000) });
  const req = makeRequest(largePayload);
  await assert.rejects(async () => {
    await readBoundedJsonBody(req, 100);
  }, HttpBodyTooLargeError);
});

test("readBoundedJsonBody rejects malformed JSON", async () => {
  const req = makeRequest("{ invalid json ");
  await assert.rejects(async () => {
    await readBoundedJsonBody(req);
  }, InvalidJsonBodyError);
});

test("parseOptionalBoundedJsonBody handles empty bodies", async () => {
  const Schema = z.object({ value: z.string() });
  const emptyReq = makeRequest("");
  const res = await parseOptionalBoundedJsonBody(emptyReq, Schema);
  assert.equal(res, undefined);

  const rawEmpty = await readOptionalBoundedJsonBody(emptyReq);
  assert.equal(rawEmpty, undefined);
});
