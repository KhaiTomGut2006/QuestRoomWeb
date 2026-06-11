import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  bsonEqual,
  buildUniqueIdentity,
  isRetryableWriteError,
  parseArgs,
  sanitizeCollectionOptions,
  sanitizeIndexOptions,
  syncBatch
} = require("../scripts/migrate-dekhub-database.js");

test("database migration defaults to a non-destructive dry-run", () => {
  const options = parseArgs([]);

  assert.equal(options.confirm, false);
  assert.equal(options.sourceDb, "dekhub");
  assert.equal(options.targetDb, "dekhub");
});

test("database migration can apply incremental changes with confirm", () => {
  const options = parseArgs(["--confirm"]);
  assert.equal(options.confirm, true);
});

test("collection options exclude server-generated metadata", () => {
  assert.deepEqual(
    sanitizeCollectionOptions({
      uuid: "server-generated",
      validator: { name: { $type: "string" } },
      validationLevel: "strict"
    }),
    {
      validator: { name: { $type: "string" } },
      validationLevel: "strict"
    }
  );
});

test("index options keep name and uniqueness but remove key metadata", () => {
  assert.deepEqual(
    sanitizeIndexOptions({
      v: 2,
      ns: "dekhub.members",
      key: { discord_id: 1 },
      name: "discord_id_1",
      unique: true,
      sparse: true
    }),
    {
      name: "discord_id_1",
      unique: true,
      sparse: true
    }
  );
});

test("BSON comparison detects changed values", () => {
  assert.equal(bsonEqual({ _id: 1, coin: "5" }, { _id: 1, coin: "5" }), true);
  assert.equal(bsonEqual({ _id: 1, coin: "5" }, { _id: 1, coin: "6" }), false);
});

test("network timeouts are treated as retryable writes", () => {
  assert.equal(isRetryableWriteError(new Error("connection timed out")), true);
  assert.equal(isRetryableWriteError(new Error("duplicate key")), false);
});

test("unique identity supports compound indexes", () => {
  const identity = buildUniqueIdentity(
    { discord_id: "123", date: "2026-06-05" },
    { name: "discord_id_1_date_1", key: { discord_id: 1, date: 1 } }
  );
  assert.match(identity, /^discord_id_1_date_1:/);
});

test("syncBatch inserts new documents and replaces only changed documents", async () => {
  const writes = [];
  const targetCollection = {
    find() {
      return {
        async toArray() {
          return [
            { _id: 1, value: "same" },
            { _id: 2, value: "old" },
            { _id: 4, targetOnly: true }
          ];
        }
      };
    },
    async bulkWrite(operations) {
      writes.push(...operations);
    }
  };

  const result = await syncBatch(
    targetCollection,
    [
      { _id: 1, value: "same" },
      { _id: 2, value: "new" },
      { _id: 3, value: "insert" }
    ],
    true
  );

  assert.deepEqual(result, { inserts: 1, updates: 1, unchanged: 1 });
  assert.deepEqual(writes, [
    {
      replaceOne: {
        filter: { _id: 2 },
        replacement: { _id: 2, value: "new" },
        upsert: false
      }
    },
    {
      insertOne: {
        document: { _id: 3, value: "insert" }
      }
    }
  ]);
});

test("syncBatch updates a document matched by a unique index while preserving target _id", async () => {
  const writes = [];
  const targetCollection = {
    find() {
      return {
        async toArray() {
          return [{ _id: "target-id", discord_id: "123", date: "2026-06-05", value: "old" }];
        }
      };
    },
    async bulkWrite(operations) {
      writes.push(...operations);
    }
  };

  const result = await syncBatch(
    targetCollection,
    [{ _id: "source-id", discord_id: "123", date: "2026-06-05", value: "new" }],
    true,
    [{ name: "discord_id_1_date_1", key: { discord_id: 1, date: 1 }, unique: true }]
  );

  assert.deepEqual(result, { inserts: 0, updates: 1, unchanged: 0 });
  assert.deepEqual(writes[0], {
    replaceOne: {
      filter: { _id: "target-id" },
      replacement: {
        _id: "target-id",
        discord_id: "123",
        date: "2026-06-05",
        value: "new"
      },
      upsert: false
    }
  });
});
