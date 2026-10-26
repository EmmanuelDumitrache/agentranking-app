import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adminAccountsResourceKey,
  adminContactResourceKey,
  adminVerificationRequestsResourceKey,
  normalizeAdminAccountsQuery,
  normalizeAdminContactQuery,
  normalizeAdminCreatorsQuery,
  normalizeAdminVerificationRequestsQuery,
} from "../query.js";

describe("admin identity query normalization", () => {
  it("bounds account pagination and trims filters", () => {
    assert.deepEqual(
      normalizeAdminAccountsQuery({
        page: "-2",
        perPage: "1000",
        search: "  alice  ",
        status: "",
      }),
      {
        page: 1,
        perPage: 100,
        search: "alice",
        status: "all",
      },
    );
  });

  it("canonicalizes dashboard contact filters", () => {
    const query = normalizeAdminContactQuery({
      page: "2",
      status: "resolved",
      dashboardOnly: "true",
    });
    assert.deepEqual(query, {
      page: 2,
      perPage: 25,
      status: "all",
      dashboardOnly: true,
    });
    assert.equal(
      adminContactResourceKey(query),
      'admin-contact:[2,25,"dashboard"]',
    );
  });

  it("normalizes unsupported creator providers", () => {
    assert.equal(
      normalizeAdminCreatorsQuery({ provider: "unsupported" }).provider,
      "all",
    );
  });

  it("keeps verification status in the exact request identity", () => {
    const query = normalizeAdminVerificationRequestsQuery({
      page: "3",
      perPage: "2",
      status: "approved",
    });
    assert.equal(query.perPage, 10);
    assert.equal(
      adminVerificationRequestsResourceKey(query),
      'admin-verification-requests:["approved",3,10]',
    );
  });

  it("does not collide when filters contain separators", () => {
    const first = adminAccountsResourceKey({
      page: 1,
      perPage: 25,
      status: "a:b",
      search: "c",
    });
    const second = adminAccountsResourceKey({
      page: 1,
      perPage: 25,
      status: "a",
      search: "b:c",
    });
    assert.notEqual(first, second);
  });
});
