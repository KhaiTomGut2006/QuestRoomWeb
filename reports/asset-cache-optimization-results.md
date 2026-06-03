# Asset Cache Optimization Results

วันที่ทำการแก้ไข: 2026-06-03

## สิ่งที่ทำแล้ว

### 1. เพิ่ม WebP assets

สร้างไฟล์ `.webp` คู่กับ PNG ทั้งหมดใน `public/assets`

ผลรวม:

- PNG เดิมรวมประมาณ 12,719,961 bytes
- WebP ใหม่รวมประมาณ 1,365,710 bytes
- ลดลงประมาณ 11,354,251 bytes

ตัวอย่างไฟล์สำคัญ:

- `room1.png` 2,129,069 -> `room1.webp` 204,520
- `Friends.png` 1,119,201 -> `Friends.webp` 93,680
- `Coin.png` 184,721 -> `Coin.webp` 24,128
- `NPC/Nite.png` 622,700 -> `NPC/Nite.webp` 87,012
- `Rank/Diamond.png` 828,599 -> `Rank/Diamond.webp` 69,896

### 2. เปลี่ยน local game assets ให้เรียก WebP

เพิ่ม helper:

- `src/lib/basePath.js`
  - `withOptimizedAsset(path)`

Helper นี้จะแปลง path ที่เป็น `/assets/*.png` ให้เป็น `.webp` อัตโนมัติ และยังคง query string เช่น `?v=4`

ปรับ component หลัก:

- `RoomCanvas`
- `GameShell`
- `NpcDoorVisitor`
- `NpcVisitModal`
- `FriendsModal`
- `GlobalQuestModal`
- `ProfileModal`
- `RankingModal`
- `RewardModal`
- `TutorialMode`
- `QuestReceivedPopup`
- `ChallengeModal`
- `ActiveQuestPanel`

### 3. ตั้ง browser cache ระยะยาว

เพิ่ม cache headers ใน `next.config.mjs`

```text
Cache-Control: public, max-age=31536000, immutable
```

ใช้กับ:

- `/assets/:path*`
- `/favicon.ico`
- `/favicon.png`

ผลลัพธ์คือ browser จะโหลด asset ครั้งแรก แล้วใช้ cache ต่อไปจนกว่าผู้เล่น clear cache หรือ URL เปลี่ยน

### 4. ลด initial audio load

ปรับ `bgmusic.mp3` ไม่ให้ preload ตั้งแต่เปิดหน้า

เดิม:

```js
new Audio("/assets/bgmusic.mp3")
```

ใหม่:

```js
const audio = new Audio();
audio.preload = "none";
audio.src = "/assets/bgmusic.mp3";
```

เพลงจะเริ่มโหลดเมื่อมี user interaction และเรียก play จริง หลังจากนั้น browser จะ cache ตาม header 1 ปี

### 5. เพิ่ม lazy loading สำหรับรูปใน modal/list

เพิ่ม `loading="lazy"` ในจุดที่เป็น modal/list เช่น:

- Friends list avatars/badges
- Global Quest media/avatar
- Profile media/avatar/accessory
- Ranking badges

## การทดสอบที่ผ่าน

### Build

```bash
npm.cmd run check
```

ผ่านเรียบร้อย

### HTTP cache header verification

ตรวจด้วย local server:

```text
room1.webp status=200 cache=public, max-age=31536000, immutable type=image/webp
Coin.webp status=200 cache=public, max-age=31536000, immutable type=image/webp
Friends.webp status=200 cache=public, max-age=31536000, immutable type=image/webp
bgmusic.mp3 status=200 cache=public, max-age=31536000, immutable type=audio/mpeg
```

หลังเทสไม่มี `node` process ค้าง

## ข้อจำกัด

- ยังไม่ได้ลดขนาด `bgmusic.mp3` เพราะเครื่องนี้ไม่มี `ffmpeg`
- แนะนำให้ encode เพลงใหม่เป็นไฟล์เล็กลง เช่น 128kbps MP3/AAC หรือ loop สั้น ๆ
- ถ้า production ใช้ nginx serve `/assets/` เอง ต้องตั้ง cache header แบบเดียวกันใน nginx ด้วย ไม่ใช่พึ่ง Next config อย่างเดียว

ตัวอย่าง nginx:

```nginx
location /assets/ {
  alias /path/to/QuestRoomWeb/public/assets/;
  expires 1y;
  add_header Cache-Control "public, max-age=31536000, immutable";
}
```

