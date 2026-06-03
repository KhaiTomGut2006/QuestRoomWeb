# Performance Implementation Results

วันที่ทำการแก้ไข: 2026-06-03

## สิ่งที่แก้แล้ว

### 1. Socket.IO default เป็น WebSocket-only

ไฟล์ที่แก้:

- `server.js`
- `src/components/GameShell.jsx`
- `.env.example`

ผลลัพธ์:

- production default ไม่เปิด HTTP polling fallback แล้ว
- ถ้าจำเป็นต้อง debug proxy สามารถเปิดได้ด้วย env:

```env
NEXT_PUBLIC_SOCKET_ALLOW_POLLING=true
SOCKET_ALLOW_POLLING=true
```

ค่า default:

```env
NEXT_PUBLIC_SOCKET_ALLOW_POLLING=false
SOCKET_ALLOW_POLLING=false
```

### 2. Movement ไม่เขียน DB ทุกคลิกแล้ว

ไฟล์ที่แก้:

- `src/components/GameShell.jsx`
- `src/app/api/player/me/route.js`
- `src/lib/player.js`

ผลลัพธ์:

- realtime movement ยังส่งผ่าน socket เหมือนเดิม
- persisted position จะ save แบบ throttle ทุก 60 วินาที
- ตอน tab ถูกซ่อนจะพยายาม save position ล่าสุด
- `PATCH /api/player/me` ไม่ return member object ใหญ่แล้ว ตอบแค่ `{ ok, position }`
- backend ใช้ `Member.updateOne()` แทน `findOneAndUpdate()` + `normalizeMember()`

### 3. ลด polling interval ของ API ที่ไม่จำเป็นต้องถี่

ไฟล์ที่แก้:

- `src/components/GameShell.jsx`

ค่าใหม่:

- `/api/player/me`: 15 วินาที -> 120 วินาที
- `/api/player/rooms`: 60 วินาที -> 300 วินาที
- `/api/player/social-status`: 60 วินาที -> 300 วินาที
- `room:peek`: 10 วินาที -> 60 วินาที

### 4. Cache levels และ NPC level config

ไฟล์ที่แก้:

- `src/lib/player.js`
- `server.js`
- `.env.example`

ผลลัพธ์:

- `getAvailableLevels()` ไม่ force reload DB ทุก request แล้ว
- `LEVEL_CACHE_TTL_MS` default เป็น 300 วินาที
- `server.js` cache `levels.npcSpawns` และ `levels.npcShop` สำหรับ NPC cycle/shop

### 5. Cache quest/hint templates

ไฟล์ที่แก้:

- `src/app/api/quest-templates/route.js`
- `src/app/api/hint-templates/route.js`
- `src/components/GameShell.jsx`
- `.env.example`

ผลลัพธ์:

- server cache templates 300 วินาที
- client cache templates ใน session เดียวกัน
- PUT route จะ invalidate cache

### 6. Upload guard เพื่อลดโอกาส RAM spike

ไฟล์ที่แก้:

- `src/app/api/player/npc-quest/upload/route.js`
- `.env.example`

ผลลัพธ์:

- production ไม่ fallback ไป GridFS โดยอัตโนมัติแล้ว
- ต้องใช้ R2/Vercel Blob direct upload หรือเปิด `ALLOW_GRIDFS_UPLOADS=true` เอง
- GridFS max ใน example ลดเป็น 2MB

### 7. Ranking cache

ไฟล์ที่แก้:

- `src/lib/player.js`
- `.env.example`

ผลลัพธ์:

- ranking cache default 60 วินาที
- ลดการ query/sort ซ้ำเมื่อผู้เล่นเปิด ranking modal หลายคน

### 8. Mongo connection options ฝั่ง socket server

ไฟล์ที่แก้:

- `server.js`

ผลลัพธ์:

- socket-side DB access ใช้ pool/timeout env แบบเดียวกับ API DB helper
- ลดโอกาส DB operation ค้างนานโดยไม่มี timeout

## การทดสอบที่ผ่าน

### Production build

คำสั่ง:

```bash
npm.cmd run check
```

ผลลัพธ์:

- Next.js production build ผ่าน
- TypeScript step ผ่าน
- route generation ผ่าน

### Local socket load test

รอบที่ 1:

```json
{
  "clientsRequested": 120,
  "connected": 120,
  "failures": 0,
  "allWebsocket": true,
  "transports": ["websocket"],
  "roomStates": 120,
  "patches": 2362,
  "leaves": 0
}
```

รอบที่ 2:

```json
{
  "clientsRequested": 80,
  "connected": 80,
  "allWebsocket": true,
  "uniqueTransports": ["websocket"],
  "states": 80,
  "patches": 922
}
```

หมายเหตุ:

- load test ใช้ `tutorial-room-load-test` เพื่อไม่เขียนข้อมูล production ลง DB
- ทดสอบ socket join, room state, movement patch, websocket-only transport
- หลังเทสตรวจแล้วไม่มี `node` process ค้าง

## สิ่งที่ยังไม่ทำในรอบนี้

### 1. Migration `npcQuestSubmissions` ไป collection ใหม่

ยังไม่ทำ เพราะเป็น data migration ที่กระทบข้อมูล production โดยตรง ต้อง backup และทดสอบ migration script ก่อน

แนะนำทำเป็นเฟสถัดไป:

- สร้าง `QuestSubmission` model
- migrate จาก `Member.npcQuestSubmissions`
- เปลี่ยน global/profile/reaction routes ไปใช้ collection ใหม่
- เก็บ fallback อ่านข้อมูลเก่าชั่วคราว

### 2. Migration `coin` จาก String เป็น Number

ยังไม่ทำ เพราะกระทบทุก route ที่ใช้เงิน ต้อง migration แบบมี fallback

แนะนำทำเป็นเฟสถัดไป:

- เพิ่ม `coinsV2`
- migrate ค่าเดิมจาก `coin`
- route อ่าน/เขียน `coinsV2`
- หลังนิ่งแล้วค่อยเลิกใช้ `coin`

### 3. Atomic rewrite ครบทุก action route

ยังไม่ rewrite ทั้งหมด เพราะ route บางตัวมี business logic หลายขั้น เช่น shop item/chest/quest reward/tutorial badge

หลังลด request storm แล้ว ควรทำต่อแบบ endpoint-by-endpoint พร้อม test เฉพาะ:

- gamble
- hint
- npc-reward
- npc-shop
- npc-quest
- challenge

## Production deployment checklist

1. ตั้ง nginx websocket upgrade ให้ถูกต้อง
2. deploy ด้วย `NEXT_PUBLIC_SOCKET_ALLOW_POLLING=false` และ `SOCKET_ALLOW_POLLING=false`
3. ตั้ง R2 หรือ Vercel Blob สำหรับ direct upload
4. ห้ามเปิด `ALLOW_GRIDFS_UPLOADS=true` ใน production ยกเว้นจำเป็นและจำกัดไฟล์เล็ก
5. monitor nginx access log ว่าไม่มี `transport=polling`
6. monitor Node memory หลังเปิดใช้งานจริง
7. monitor MongoDB slow query และ connection pool

