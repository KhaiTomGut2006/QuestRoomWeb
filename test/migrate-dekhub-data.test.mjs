import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { buildSetFields, parseArgs } = require("../scripts/migrate-dekhub-data.js");

test("fill-missing preserves populated target fields and fills nested gaps", () => {
  const source = {
    _id: "source-id",
    discord_id: "123",
    nickname: "Source name",
    profile: {
      title: "Builder",
      color: "blue"
    },
    courses: ["A"]
  };
  const target = {
    _id: "target-id",
    discord_id: "123",
    nickname: "Target name",
    profile: {
      title: "",
      color: "red"
    },
    courses: []
  };

  const fields = buildSetFields(source, target, {
    mode: "fill-missing",
    matchKey: "discord_id",
    excludeFields: new Set(["_id"])
  });

  assert.deepEqual(fields, {
    "profile.title": "Builder",
    courses: ["A"]
  });
});

test("source-wins returns changed source fields without _id or match key", () => {
  const fields = buildSetFields(
    {
      _id: "source-id",
      discord_id: "123",
      nickname: "Source name",
      profile: { color: "blue" }
    },
    {
      discord_id: "123",
      nickname: "Target name",
      profile: { color: "red" }
    },
    {
      mode: "source-wins",
      matchKey: "discord_id",
      excludeFields: new Set(["_id"])
    }
  );

  assert.deepEqual(fields, {
    nickname: "Source name",
    profile: { color: "blue" }
  });
});

test("fill-missing replaces a null parent with the source object", () => {
  const fields = buildSetFields(
    {
      discord_id: "123",
      profile: { color: "blue", title: "Builder" }
    },
    {
      discord_id: "123",
      profile: null
    },
    {
      mode: "fill-missing",
      matchKey: "discord_id",
      excludeFields: new Set(["_id"])
    }
  );

  assert.deepEqual(fields, {
    profile: { color: "blue", title: "Builder" }
  });
});

test("parseArgs defaults to dry-run and the members collection", () => {
  const options = parseArgs([]);

  assert.equal(options.confirm, false);
  assert.equal(options.mode, "fill-missing");
  assert.equal(options.matchKey, "discord_id");
  assert.equal(options.sourceDb, "dekhub");
  assert.equal(options.sourceCollection, "members");
  assert.equal(options.targetCollection, "members");
  assert.equal(options.targetDb, "dekhub");
});
