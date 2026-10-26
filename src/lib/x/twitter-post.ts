/**
 * X API v2 tweet + v1.1 media upload (OAuth 1.0a for media), using the application OAuth 1.0a media-upload flow.
 */
import crypto from "node:crypto";
import { z } from "zod";
import { parseBoundedJsonBody } from "@/lib/bounded-http-body";
const X_API_URL = "https://api.twitter.com/2/tweets";
const X_MEDIA_UPLOAD_URL = "https://upload.twitter.com/1.1/media/upload.json";

const XMediaUploadResponseSchema = z.object({
  media_id_string: z.string().optional(),
  media_id: z.union([z.number(), z.string()]).optional(),
  errors: z.array(z.object({ message: z.string().optional() })).optional(),
});

type XMediaUploadResponse = z.infer<typeof XMediaUploadResponseSchema>;

const XPostResponseSchema = z.object({
  data: z.object({ id: z.string().optional() }).optional(),
  errors: z.array(z.object({ message: z.string().optional() })).optional(),
  detail: z.string().optional(),
});

type XPostResponse = z.infer<typeof XPostResponseSchema>;
function readEnv() {
  return {
    consumerKey: process.env.X_CONSUMER_KEY ?? "",
    consumerSecret: process.env.X_CONSUMER_SECRET ?? "",
    accessToken: process.env.X_ACCESS_TOKEN ?? "",
    accessTokenSecret: process.env.X_ACCESS_TOKEN_SECRET ?? "",
    oauth2UserAccessToken: process.env.X_OAUTH2_USER_ACCESS_TOKEN?.trim() ?? "",
  };
}
export function assertPostingCredentialsConfigured() {
  const e = readEnv();
  if (e.oauth2UserAccessToken) return;
  if (!e.consumerKey || !e.consumerSecret || !e.accessToken || !e.accessTokenSecret) {
    throw new Error(
      "X API: set X_OAUTH2_USER_ACCESS_TOKEN or all of X_CONSUMER_KEY, X_CONSUMER_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET"
    );
  }
}
export function assertOAuth1CredentialsForMedia() {
  const e = readEnv();
  if (!e.consumerKey || !e.consumerSecret || !e.accessToken || !e.accessTokenSecret) {
    throw new Error(
      "Media upload needs OAuth 1.0a: X_CONSUMER_KEY, X_CONSUMER_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET"
    );
  }
}
function percentEncode(str: string) {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => {
    const code = c.codePointAt(0);
    return code != null ? `%${code.toString(16).toUpperCase()}` : c;
  });
}
export function buildOAuthHeader(method: string, url: string, bodyParams: Record<string, string> = {}) {
  const e = readEnv();
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: e.consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: e.accessToken,
    oauth_version: "1.0",
  };
  const allParams = { ...oauthParams, ...bodyParams };
  const sortedParams = Object.keys(allParams)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(allParams[k]!)}`)
    .join("&");
  const signatureBase = [method.toUpperCase(), percentEncode(url), percentEncode(sortedParams)].join("&");
  const signingKey = `${percentEncode(e.consumerSecret)}&${percentEncode(e.accessTokenSecret)}`;
  const signature = crypto.createHmac("sha1", signingKey).update(signatureBase).digest("base64");
  const headerParams: Record<string, string> = { ...oauthParams, oauth_signature: signature };
  const headerStr = Object.keys(headerParams)
    .sort()
    .map((k) => `${percentEncode(k)}="${percentEncode(headerParams[k]!)}"`)
    .join(", ");
  return `OAuth ${headerStr}`;
}
export async function uploadMediaPng(buffer: Buffer, filename = "card.png"): Promise<string> {
  assertOAuth1CredentialsForMedia();
  const form = new FormData();
  const pngBytes = new Uint8Array(buffer.length);
  pngBytes.set(buffer);
  form.append("media", new Blob([pngBytes], { type: "image/png" }), filename);
  const res = await fetch(X_MEDIA_UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: buildOAuthHeader("POST", X_MEDIA_UPLOAD_URL),
    },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  const data: XMediaUploadResponse = await parseBoundedJsonBody(
    res,
    XMediaUploadResponseSchema,
    2 * 1024 * 1024,
  ).catch(() => ({}));
  if (!res.ok) {
    const msg = data?.errors?.[0]?.message ?? JSON.stringify(data);
    throw new Error(`Media upload failed (${res.status}): ${msg}`);
  }
  const id =
    data?.media_id_string ?? (data?.media_id != null ? String(data.media_id) : null);
  if (!id) throw new Error("Media upload: missing media_id_string in response");
  return id;
}
export async function postTweet(
  text: string,
  opts: { replyToId?: string | null; mediaIds?: string[] | null } = {}
): Promise<string | null> {
  const e = readEnv();
  const body: Record<string, unknown> = { text };
  if (opts.replyToId) {
    body.reply = { in_reply_to_tweet_id: opts.replyToId };
  }
  if (opts.mediaIds?.length) {
    body.media = { media_ids: opts.mediaIds };
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (e.oauth2UserAccessToken) {
    headers.Authorization = `Bearer ${e.oauth2UserAccessToken}`;
  } else {
    assertPostingCredentialsConfigured();
    headers.Authorization = buildOAuthHeader("POST", X_API_URL);
  }
  const res = await fetch(X_API_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const data: XPostResponse = await parseBoundedJsonBody(
    res,
    XPostResponseSchema,
    256 * 1024,
  ).catch(() => ({}));
  if (!res.ok) {
    const msg =
      data?.errors?.map((x) => x.message).filter(Boolean).join("; ") ||
      data?.detail ||
      JSON.stringify(data);
    throw new Error(`Tweet failed (${res.status}): ${msg}`);
  }
  return data?.data?.id ?? null;
}
export async function postVerifiedTweetWithCard(text: string, png: Buffer): Promise<{ tweetId: string; url: string }> {
  const mediaId = await uploadMediaPng(png, "verified-card.png");
  const tweetId = await postTweet(text, { mediaIds: [mediaId] });
  if (!tweetId) throw new Error("No tweet ID returned");
  const url = `https://x.com/agentranking/status/${tweetId}`;
  return { tweetId, url };
}