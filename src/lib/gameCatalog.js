export const GAME_ITEM_CATALOG = [
  {
    id: "quest-scroll-normal",
    label: "Quest Roll Normal",
    image: "/assets/Item/quest.png",
    shadowImage: "/assets/ItemShadow/quest_shadow.webp",
    defaultPrice: 50,
    canShopSell: true,
    canBoxDrop: true
  },
  {
    id: "quest-scroll-rare",
    label: "Quest Roll Rare",
    image: "/assets/Item/quest.png",
    shadowImage: "/assets/ItemShadow/quest_shadow.webp",
    defaultPrice: 100,
    canShopSell: true,
    canBoxDrop: true
  },
  {
    id: "quest-scroll-epic",
    label: "Quest Roll Epic",
    image: "/assets/Item/quest.png",
    shadowImage: "/assets/ItemShadow/quest_shadow.webp",
    defaultPrice: 400,
    canShopSell: true,
    canBoxDrop: true
  },
  {
    id: "chest-small",
    label: "Chest Small",
    image: "/assets/ItemShadow/chest_shadow.webp",
    shadowImage: "/assets/ItemShadow/chest_shadow.webp",
    defaultPrice: 50,
    canShopSell: true,
    canBoxDrop: true
  },
  {
    id: "chest-medium",
    label: "Chest Medium",
    image: "/assets/ItemShadow/chest_shadow.webp",
    shadowImage: "/assets/ItemShadow/chest_shadow.webp",
    defaultPrice: 100,
    canShopSell: true,
    canBoxDrop: true
  },
  {
    id: "chest-large",
    label: "Chest Large",
    image: "/assets/ItemShadow/chest_shadow.webp",
    shadowImage: "/assets/ItemShadow/chest_shadow.webp",
    defaultPrice: 350,
    canShopSell: true,
    canBoxDrop: true
  },
  {
    id: "cooldown-minute",
    label: "Cooldown -1 min Lv1",
    image: "/assets/Item/Cooldown.png",
    shadowImage: "/assets/ItemShadow/cooldown_shadow.webp",
    defaultPrice: 200,
    note: "ซื้อได้สูงสุด 5 ครั้ง",
    canShopSell: true,
    canBoxDrop: true
  },
  {
    id: "cooldown-minute-lv2",
    label: "Cooldown -1 min Lv2",
    image: "/assets/Item/Cooldown.png",
    shadowImage: "/assets/ItemShadow/cooldown_shadow.webp",
    defaultPrice: 400,
    note: "ต้องซื้อ Limit Break ก่อนถึงซื้อได้",
    canShopSell: true,
    canBoxDrop: true
  },
  {
    id: "limit-break",
    label: "Limit Break",
    image: "/assets/Item/limitbreak.png",
    shadowImage: "/assets/ItemShadow/quest_shadow.webp",
    defaultPrice: 2000,
    note: "ปลดล็อค Cooldown Lv2 และยกเลิกขีดจำกัดต่างๆ",
    canShopSell: true,
    canBoxDrop: true
  },
  {
    id: "asset-ticket",
    label: "Asset Ticket",
    image: "/assets/Item/AssetTicket.png",
    shadowImage: "/assets/ItemShadow/ticket_shadow.webp",
    defaultPrice: 500,
    canShopSell: true,
    canBoxDrop: true
  },
  {
    id: "accessory-mrx",
    label: "Accessory: Mr. X",
    image: "/assets/Accessories/mrX.png",
    shadowImage: "/assets/ItemShadow/mrX_shadow.webp",
    defaultPrice: 10000,
    canShopSell: true,
    canBoxDrop: false
  },
  {
    id: "accessory-mrx-red-eye",
    label: "Accessory: Mr. X Red Eye",
    image: "/assets/Accessories/mrXredeye.png",
    shadowImage: "/assets/ItemShadow/mrX_shadow.webp",
    defaultPrice: 20000,
    canShopSell: true,
    canBoxDrop: false
  },
  {
    id: "accessory-mrx-glasses",
    label: "Accessory: Mr. X with Glasses",
    image: "/assets/Accessories/mrXwithGlasses.png",
    shadowImage: "/assets/ItemShadow/mrX_shadow.webp",
    defaultPrice: 15000,
    canShopSell: true,
    canBoxDrop: false
  },
  {
    id: "accessory-ppuk",
    label: "Accessory: P'Puk",
    image: "/assets/Accessories/ppuk.png",
    shadowImage: "/assets/ItemShadow/puk_shadow.webp",
    defaultPrice: 8000,
    canShopSell: true,
    canBoxDrop: false
  }
];

export const GAME_NPC_CATALOG = [
  { id: "chest", label: "Treasure Chest", image: "/assets/NPC/chest_open.png", shadowImage: "/assets/ItemShadow/chest_shadow.webp" },
  { id: "shop", label: "Shop - Milt", image: "/assets/NPC/Milt.png", shadowImage: "/assets/ItemShadow/shop_shadow.webp" },
  { id: "quest-easy", label: "Quest Easy - Near", image: "/assets/NPC/Near.png", shadowImage: "/assets/ItemShadow/quest_shadow.webp" },
  { id: "quest-medium", label: "Quest Medium - Fact", image: "/assets/NPC/Fact.png", shadowImage: "/assets/ItemShadow/fact_shadow.webp" },
  { id: "hints", label: "Hints - Smith", image: "/assets/NPC/Smith.png", shadowImage: "/assets/ItemShadow/smith_shadow.webp" },
  { id: "quest-hard", label: "Quest Hard - Nite", image: "/assets/NPC/Nite.png", shadowImage: "/assets/ItemShadow/nite_shadow.webp" },
  { id: "stupid-quest", label: "Stupid Quest - Begger", image: "/assets/NPC/Begger.png", shadowImage: "/assets/ItemShadow/stupidquest_shadow.webp" },
  { id: "gambling", label: "Gambling - Begger", image: "/assets/NPC/Begger.png", shadowImage: "/assets/ItemShadow/bedder_shadow.webp" }
];

export const GAME_ITEM_BY_ID = new Map(GAME_ITEM_CATALOG.map((item) => [item.id, item]));
export const GAME_NPC_BY_ID = new Map(GAME_NPC_CATALOG.map((npc) => [npc.id, npc]));

export function getGameItem(id) {
  return GAME_ITEM_BY_ID.get(String(id || "")) || null;
}

export function getGameNpc(id) {
  return GAME_NPC_BY_ID.get(String(id || "")) || null;
}
