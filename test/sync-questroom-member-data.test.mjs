import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  QUESTROOM_FIELDS,
  pickQuestroomFields,
  syncBatch
} = require("../scripts/sync-questroom-member-data.js");

test("QuestRoom field list includes progression, coins, quests, and inventory", () => {
  for (const field of [
    "coin",
    "questCoin",
    "stage",
    "state",
    "substate",
    "quest",
    "questReward",
    "npcQuest",
    "ownedAccessories",
    "inventory"
  ]) {
    assert.equal(QUESTROOM_FIELDS.includes(field), true, field);
  }
});

test("pickQuestroomFields excludes unrelated profile fields", () => {
  assert.deepEqual(
    pickQuestroomFields({
      discord_id: "123",
      email: "private@example.com",
      coin: "50",
      stage: "stage-2",
      ownedAccessories: ["hat"]
    }),
    {
      coin: "50",
      stage: "stage-2",
      ownedAccessories: ["hat"]
    }
  );
});

test("syncBatch updates matching discord user without replacing profile data", async () => {
  const operations = [];
  const collection = {
    find() {
      return {
        async toArray() {
          return [{
            _id: "target-id",
            discord_id: "123",
            coin: "10",
            stage: "stage-1",
            npcQuest: { title: "stale quest" }
          }];
        }
      };
    },
    async bulkWrite(value) {
      operations.push(...value);
    }
  };

  const result = await syncBatch(
    collection,
    [{ _id: "source-id", discord_id: "123", coin: "20", stage: "stage-2", email: "ignored@example.com" }],
    true
  );

  assert.deepEqual(result, {
    insertedUsers: 0,
    updatedUsers: 1,
    unchangedUsers: 0,
    fieldsChanged: 3
  });
  assert.deepEqual(operations, [{
    updateOne: {
      filter: { _id: "target-id" },
      update: {
        $set: { coin: "20", stage: "stage-2" },
        $unset: { npcQuest: "" }
      }
    }
  }]);
});
