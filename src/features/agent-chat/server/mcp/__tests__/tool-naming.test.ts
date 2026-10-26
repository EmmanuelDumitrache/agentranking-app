import assert from "node:assert/strict";
import test from "node:test";
import { mcpToolAlias, mcpToolNameSlug } from "../tool-naming";

test("runtime aliases use the immutable connection key and are stable across presentation changes", () => {
  const connection = { id: "connection-1", runtimeKey: "nansen_0123456789ab" };
  const alias = mcpToolAlias(connection, { name: "Wallet PnL / historical" });
  assert.equal(alias, "mcp__nansen_0123456789ab__wallet_pnl_historical");
  assert.equal(alias, mcpToolAlias({ ...connection }, { name: "Wallet PnL / historical" }));
  assert.ok(alias.length <= 64);
});

test("collision suffixes are deterministic and distinguish external tools", () => {
  const connection = { id: "connection-1", runtimeKey: "stable" };
  const left = mcpToolAlias(connection, { name: "one" }, 12);
  const same = mcpToolAlias(connection, { name: "one" }, 12);
  const right = mcpToolAlias(connection, { name: "two" }, 12);
  assert.equal(left, same);
  assert.notEqual(left, right);
  assert.match(left, /^mcp__stable__one_[0-9a-f]{12}$/);
});

test("sanitization is bounded and never produces an empty tool segment", () => {
  assert.equal(mcpToolNameSlug("🔥"), "tool");
  assert.equal(mcpToolNameSlug("  Read:Token.Price  "), "read_token_price");
});
