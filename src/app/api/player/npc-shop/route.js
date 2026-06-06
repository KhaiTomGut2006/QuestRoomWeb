import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import Member from "@/models/Member";
import { MEMBER_INTERACTION_SELECT, normalizeMemberInteraction } from "@/lib/player";
import { getNpcShopItem, grantShopItem, openChestReward } from "@/lib/shop";
import { assertActiveNpcVisit } from "@/lib/npcVisit";

const MEMBER_READ_QUERY_MAX_TIME_MS = Math.max(500, Number(process.env.MEMBER_READ_QUERY_MAX_TIME_MS || 3_000));

function questCoinExpression() {
  return {
    $convert: {
      input: { $ifNull: ["$questCoin", "0"] },
      to: "int",
      onError: 0,
      onNull: 0
    }
  };
}

export async function POST(request) {
  const session = await getServerSession(authOptions);
  const discordId = session?.user?.discordId;
  if (!discordId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const { itemId, visitId } = await request.json();
    await connectDb();
    const member = await Member.findOne({ discord_id: String(discordId) })
      .select(MEMBER_INTERACTION_SELECT)
      .maxTimeMS(MEMBER_READ_QUERY_MAX_TIME_MS);
    if (!member) return NextResponse.json({ error: "member_not_found" }, { status: 404 });
    assertActiveNpcVisit(member, visitId);
    const item = await getNpcShopItem(member.stage, itemId);
    if (!item) return NextResponse.json({ error: "invalid_item_for_stage" }, { status: 400 });

    // Enforce the configured stock for this NPC visit.
    const visitPurchases = member.npcVisitId === visitId ? (member.npcVisitPurchases || []) : [];
    const purchaseCount = visitPurchases.filter((purchase) => purchase === itemId).length;
    if (visitId) {
      if (purchaseCount >= item.maxQty) {
        return NextResponse.json({ error: "item_stock_exhausted" }, { status: 400 });
      }
    }

    // Quest scroll: cannot buy while a quest is active
    if (item.questDifficulty) {
      if (member.npcQuest) {
        return NextResponse.json({ error: "active_quest_exists" }, { status: 409 });
      }
    }

    // Chest: no stock limit, handled below

    // Tier-specific stock validation
    if (item.cooldownTier === 1) {
      if ((member.shopCooldownT1 || 0) >= item.maxCount) {
        return NextResponse.json({ error: "cooldown_maxed", tier: 1 }, { status: 400 });
      }
    }
    if (item.cooldownTier === 2) {
      if (!member.shopLimitBreak) {
        return NextResponse.json({ error: "requires_limit_break" }, { status: 400 });
      }
      if ((member.shopCooldownT2 || 0) >= item.maxCount) {
        return NextResponse.json({ error: "cooldown_maxed", tier: 2 }, { status: 400 });
      }
    }
    if (item.limitBreak && member.shopLimitBreak) {
      return NextResponse.json({ error: "already_owned" }, { status: 400 });
    }
    if (item.accessoryId && (member.ownedAccessories || []).map(String).includes(item.accessoryId)) {
      return NextResponse.json({ error: "already_owned" }, { status: 400 });
    }

    const currentCoins = Number.parseInt(member.questCoin ?? member.coin ?? "0", 10);
    if (currentCoins < item.cost) {
      return NextResponse.json(
        { error: "not_enough_coins", coins: currentCoins, cost: item.cost },
        { status: 400 }
      );
    }

    const originalQuestCoin = String(member.questCoin ?? member.coin ?? "0");
    const originalVisitId = String(member.npcVisitId || "");
    const originalVisitPurchases = Array.isArray(member.npcVisitPurchases)
      ? member.npcVisitPurchases.map(String)
      : [];

    // Track purchases as repeated item ids so stock survives a refresh.
    if (visitId) {
      if (member.npcVisitId !== visitId) {
        member.npcVisitId = visitId;
        member.npcVisitPurchases = [itemId];
      } else {
        member.npcVisitPurchases = [...(member.npcVisitPurchases || []), itemId];
      }
    }

    member.questCoin = String(currentCoins - item.cost);

    let chestReward = null;
    let grantedItem = null;
    if (item.chestMin !== undefined) {
      chestReward = await openChestReward(member, {
        coinMin: item.chestMin,
        coinMax: item.chestMax
      });
    } else {
      grantedItem = await grantShopItem(member, itemId, item);
    }

    const commitFilter = {
      discord_id: String(discordId),
      questCoin: originalQuestCoin,
      npcVisitId: originalVisitId,
      npcVisitPurchases: originalVisitPurchases,
      $expr: { $gte: [questCoinExpression(), item.cost] }
    };
    if (item.questDifficulty) commitFilter.$or = [{ npcQuest: null }, { npcQuest: { $exists: false } }];
    if (item.cooldownTier === 1) commitFilter.shopCooldownT1 = { $lt: item.maxCount };
    if (item.cooldownTier === 2) {
      commitFilter.shopLimitBreak = true;
      commitFilter.shopCooldownT2 = { $lt: item.maxCount };
    }
    if (item.limitBreak) commitFilter.shopLimitBreak = { $ne: true };
    if (item.accessoryId) commitFilter.ownedAccessories = { $nin: [item.accessoryId] };

    const updated = await Member.findOneAndUpdate(
      commitFilter,
      {
        $set: {
          questCoin: member.questCoin,
          npcVisitId: member.npcVisitId,
          npcVisitPurchases: member.npcVisitPurchases,
          shopAssetTickets: member.shopAssetTickets,
          ownedAccessories: member.ownedAccessories,
          npcQuest: member.npcQuest,
          shopCooldownT1: member.shopCooldownT1,
          shopCooldownT2: member.shopCooldownT2,
          shopLimitBreak: member.shopLimitBreak
        }
      },
      { new: true, projection: MEMBER_INTERACTION_SELECT, maxTimeMS: MEMBER_READ_QUERY_MAX_TIME_MS }
    );
    if (!updated) return NextResponse.json({ error: "purchase_conflict", retry: true }, { status: 409 });

    return NextResponse.json({
      itemId,
      cost: item.cost,
      purchaseCount: purchaseCount + 1,
      maxQty: item.maxQty,
      cooldownReductionMs: chestReward?.cooldownReductionMs || grantedItem?.cooldownReductionMs || 0,
      assignedQuest: chestReward?.assignedQuest || grantedItem?.assignedQuest || null,
      chestReward,
      member: normalizeMemberInteraction(updated),
    });
  } catch (error) {
    const status = error.message === "npc_visit_expired" ? 409 : 503;
    return NextResponse.json({ error: error.message }, { status });
  }
}
