import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import Member from "@/models/Member";
import { normalizeMember } from "@/lib/player";
import { getNpcShopItem, grantShopItem, openChestReward } from "@/lib/shop";
import { assertActiveNpcVisit } from "@/lib/npcVisit";
import { writeErrorMessage, writeErrorStatus } from "@/lib/writeSafety";
import cooldownTokens from "@/lib/cooldownToken.cjs";

const { issueCooldownToken } = cooldownTokens;

export async function POST(request) {
  const session = await getServerSession(authOptions);
  const discordId = session?.user?.discordId;
  if (!discordId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const { itemId, visitId } = await request.json();
    await connectDb();
    const member = await Member.findOne({ discord_id: String(discordId) });
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

    const currentCoins = Number.parseInt(member.coin || "0", 10);
    if (currentCoins < item.cost) {
      return NextResponse.json(
        { error: "not_enough_coins", coins: currentCoins, cost: item.cost },
        { status: 400 }
      );
    }

    member.coin = String(currentCoins - item.cost);

    // Track purchases as repeated item ids so stock survives a refresh.
    if (visitId) {
      if (member.npcVisitId !== visitId) {
        member.npcVisitId = visitId;
        member.npcVisitPurchases = [itemId];
      } else {
        member.npcVisitPurchases = [...(member.npcVisitPurchases || []), itemId];
      }
    }

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

    await member.save({ validateModifiedOnly: true });

    const cooldownReductionMs = chestReward?.cooldownReductionMs || grantedItem?.cooldownReductionMs || 0;
    return NextResponse.json({
      itemId,
      cost: item.cost,
      purchaseCount: purchaseCount + 1,
      maxQty: item.maxQty,
      cooldownReductionMs,
      cooldownToken: issueCooldownToken({ discordId, milliseconds: cooldownReductionMs }),
      assignedQuest: chestReward?.assignedQuest || grantedItem?.assignedQuest || null,
      chestReward,
      member: normalizeMember(member),
    });
  } catch (error) {
    const status = writeErrorStatus(error, error.message === "npc_visit_expired" ? 409 : 503);
    return NextResponse.json({ error: writeErrorMessage(error) }, { status });
  }
}
