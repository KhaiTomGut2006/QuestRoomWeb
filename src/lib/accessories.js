export const ACCESSORIES = {
  "accessory-mrx": {
    id: "accessory-mrx",
    name: "Mr. X",
    cost: 5000,
    image: "mrX.png"
  },
  "accessory-mrx-red-eye": {
    id: "accessory-mrx-red-eye",
    name: "Mr. X Red Eye",
    cost: 6500,
    image: "mrXredeye.png"
  },
  "accessory-mrx-glasses": {
    id: "accessory-mrx-glasses",
    name: "Mr. X with Glasses",
    cost: 8000,
    image: "mrXwithGlasses.png"
  },
  "accessory-pukkerr": {
    id: "accessory-pukkerr",
    name: "Pukkerr",
    cost: 10000,
    image: "pukkerr.png"
  }
};

export const ACCESSORY_LIST = Object.values(ACCESSORIES);

export function getAccessory(accessoryId) {
  return ACCESSORIES[String(accessoryId || "")] || null;
}

export function getAccessoryImagePath(accessoryId) {
  const accessory = getAccessory(accessoryId);
  return accessory ? `/assets/Accessories/${accessory.image}` : "";
}
