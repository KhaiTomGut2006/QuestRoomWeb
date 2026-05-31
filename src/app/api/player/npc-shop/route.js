import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import Member from "@/models/Member";
import { normalizeMember } from "@/lib/player";
import { grantShopItem, openChestReward, SHOP_ITEMS } from "@/lib/shop";

export async function POST(request) {
  const session = await getServerSession(authOptions);
  const discordId = session?.user?.discordId;
  if (!discordId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const { itemId } = await request.json();
    const item = SHOP_ITEMS[itemId];
    if (!item) return NextResponse.json({ error: "invalid_item" }, { status: 400 });

    await connectDb();
    const member = await Member.findOne({ discord_id: String(discordId) });
    if (!member) return NextResponse.json({ error: "member_not_found" }, { status: 404 });

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

    let chestReward = null;
    let grantedItem = null;
    if (item.chestMin !== undefined) {
      chestReward = await openChestReward(member, {
        coinMin: item.chestMin,
        coinMax: item.chestMax
      });
    } else {
      grantedItem = await grantShopItem(member, itemId);
    }

    await member.save({ validateModifiedOnly: true });

    return NextResponse.json({
      itemId,
      cost: item.cost,
      cooldownReductionMs: chestReward?.cooldownReductionMs || grantedItem?.cooldownReductionMs || 0,
      assignedQuest: chestReward?.assignedQuest || grantedItem?.assignedQuest || null,
      chestReward,
      member: normalizeMember(member),
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
}
