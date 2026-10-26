import "server-only";

import { isTextUIPart, validateUIMessages } from "ai";
import { entityIdSchema } from "../shared/schemas";
import type { AgentChatUIMessage } from "../shared/ui-message";
import { HttpError } from "./http-error";

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const MAX_USER_PARTS = 16;
const MAX_TEXT_CHARS = 32_000;
const MAX_FILE_URL_CHARS = 2_000_000;
const MAX_FILENAME_CHARS = 255;

function invalidMessage(message: string): never {
  throw new HttpError(400, "INVALID_MESSAGE", message);
}

/**
 * Validate the embedded browser message with AI SDK first, then apply the
 * product/security policy for a normal user submission. The returned message
 * is canonicalized to the narrow fields the browser is allowed to author, so
 * provider metadata, tool state, data parts, and other SDK fields can never be
 * smuggled through the user-message endpoint.
 */
export async function validateInboundAgentChatUserMessage(
  input: unknown,
): Promise<AgentChatUIMessage> {
  let message: AgentChatUIMessage | undefined;
  try {
    // Browser-authored user messages intentionally have no durable metadata yet.
    // Validate the native AI SDK UIMessage structure here, then canonicalize to
    // the narrow user-authored fields below. Persisted messages are validated
    // separately with AgentRanking's required metadata schema.
    [message] = await validateUIMessages<AgentChatUIMessage>({
      messages: [input],
    });
  } catch {
    invalidMessage("Message is not a valid Agent Chat UI message");
  }

  if (!message || message.role !== "user") {
    invalidMessage("Only user messages may be submitted to this endpoint");
  }
  const id = entityIdSchema.safeParse(message.id);
  if (!id.success) invalidMessage("Message identifier is invalid");
  if (message.parts.length < 1 || message.parts.length > MAX_USER_PARTS) {
    invalidMessage(`User messages must contain 1-${MAX_USER_PARTS} parts`);
  }

  const parts: AgentChatUIMessage["parts"] = message.parts.map((part) => {
    if (isTextUIPart(part)) {
      if (part.text.length < 1 || part.text.length > MAX_TEXT_CHARS) {
        invalidMessage(`Text parts must contain 1-${MAX_TEXT_CHARS} characters`);
      }
      return { type: "text", text: part.text };
    }

    if (part.type === "file") {
      if (!ALLOWED_IMAGE_MIME_TYPES.has(part.mediaType)) {
        invalidMessage("Only supported image attachments may be submitted");
      }
      if (
        part.url.length > MAX_FILE_URL_CHARS ||
        (!part.url.startsWith("data:") && !part.url.startsWith("https://"))
      ) {
        invalidMessage("File URL must be a bounded HTTPS or data URL");
      }
      if (
        part.filename !== undefined &&
        (part.filename.trim().length < 1 ||
          part.filename.length > MAX_FILENAME_CHARS)
      ) {
        invalidMessage("Attachment filename is invalid");
      }
      return {
        type: "file",
        mediaType: part.mediaType,
        url: part.url,
        ...(part.filename === undefined ? {} : { filename: part.filename }),
      };
    }

    invalidMessage("User messages may contain only text and image parts");
  });

  return {
    id: id.data,
    role: "user",
    parts,
  };
}
