# QuestRoomWeb Performance Analysis for 100 Players

วันที่วิเคราะห์: 2026-06-03

เอกสารนี้สรุปปัญหาหลักที่ทำให้เกมช้า, request เยอะ, RAM สูง, ซื้อของ/รับเควส/ส่งเควสค้าง และเกิด `502 Bad Gateway` พร้อมแนวทางแก้แบบคงระบบเกมให้ทำงานเหมือนเดิม แต่ใช้ทรัพยากร server น้อยลงมากพอสำหรับผู้เล่นพร้อมกันระดับ 100 คน

## Executive Summary

สาเหตุหลักไม่ได้มาจากจำนวนผู้เล่น 100 คนเพียงอย่างเดียว แต่เกิดจากระบบ realtime และ API หลายจุดทำงานแบบ "ยิง request หรือเขียน DB ซ้ำ ๆ" เมื่อมีผู้เล่นจำนวนมาก

ตัวการที่ควรแก้ก่อน:

1. Socket.IO อาจ fallback เป็น HTTP polling ทำให้ request พุ่ง
2. การเดินของผู้เล่นบันทึกลง DB ผ่าน `PATCH /api/player/me` ถี่มาก
3. ทุกผู้เล่น polling `/api/player/me` ทุก 15 วินาที
4. `/api/player/rooms` บังคับ reload levels จาก DB ทุก 60 วินาที
5. Social/Global Quest ใช้ `$unwind` กับ `npcQuestSubmissions` ที่ฝังอยู่ใน `Member`
6. Upload evidence ผ่าน GridFS buffer ไฟล์ทั้งก้อนเข้า RAM
7. NPC timer และ NPC stage config มี DB read/write ที่ควร cache หรือลดความถี่
8. Action route หลายตัวใช้ read-modify-save กับ document ใหญ่ แทน atomic update

ถ้าแก้เฉพาะเฟสเร่งด่วนข้อ 1-4 จะลดโหลดได้มากทันทีโดย gameplay แทบไม่เปลี่ยน ส่วนข้อ 5-8 เป็นงานทำให้ระบบทนระยะยาวและไม่ค่อยล่มเมื่อมี social/upload/submission เพิ่มขึ้น

## อาการที่เกิดขึ้น

- Request จำนวนมากเมื่อมีผู้เล่นเกิน 100 คน
- ซื้อของช้า หรือซื้อแล้ว response ไม่กลับ
- รับเควส/ส่งเควสค้าง
- Database ทำงานหนักและรอคิว
- Node/Next process ใช้ RAM สูง
- nginx แสดง `502 Bad Gateway`
- หน้าเว็บเรียก `/api/auth/error` แล้วได้ 502

`502 Bad Gateway` จาก nginx โดยทั่วไปแปลว่า proxy ติดต่อ upstream ไม่ได้, upstream timeout, upstream crash, หรือ process ถูก kill จาก RAM/CPU ไม่พอ

## ภาพรวม request ที่เกิดจากผู้เล่น 100 คน

จากโค้ดปัจจุบัน ผู้เล่นแต่ละคนมี request หรือ socket event เหล่านี้:

- `GET /api/player/me` ตอนเข้าเกม
- `GET /api/player/me` ทุก 15 วินาที
- `PATCH /api/player/me` หลังเดิน ด้วย debounce 240ms
- `GET /api/player/rooms` ทุก 60 วินาที
- `GET /api/player/social-status` ทุก 60 วินาที
- Socket.IO connection
- Socket event `player:move`
- Socket event `player:balance`, `player:sync`, `room:peek`
- Action API เช่น shop, quest, gamble, hint, reward, upload

ถ้า WebSocket ทำงานถูกต้อง ปริมาณ request ยังพอควบคุมได้ แต่ถ้า Socket.IO fallback เป็น polling, request จะเพิ่มขึ้นหลายเท่า เพราะ realtime traffic จะกลายเป็น HTTP polling แทน persistent websocket

## 1. Socket.IO Polling Fallback

### จุดในโค้ด

- `server.js`
  - `transports: ["websocket", "polling"]`
- `src/components/GameShell.jsx`
  - `transports: ["websocket", "polling"]`

### ปัญหา

Socket.IO รองรับ fallback เป็น HTTP long polling อยู่ ถ้า nginx ไม่ได้ตั้งค่า websocket upgrade ถูกต้อง หรือ connection websocket มีปัญหา client จะ fallback ไป polling

เมื่อมีผู้เล่น 100 คน:

- WebSocket: connection ค้างไว้ 100 เส้น
- Polling: client ยิง HTTP request ซ้ำ ๆ ตลอดเวลา
- ถ้ามี movement/room update บ่อย, polling จะยิ่งกิน request และ CPU

ระบบมี `players:patch` ทุก `ROOM_PATCH_INTERVAL_MS = 100ms` ต่อห้อง ถ้า transport เป็น polling จะหนักมากกว่า websocket อย่างชัดเจน

### วิธีแก้

ขั้นแรกต้องแก้ nginx ให้ websocket ใช้งานได้จริง:

```nginx
location /socket.io/ {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_read_timeout 75s;
  proxy_send_timeout 75s;
  proxy_buffering off;
}
```

ถ้าเว็บมี base path เช่น `/questroom` ต้องให้ path ตรงกับ `NEXT_PUBLIC_BASE_PATH` เช่น:

```nginx
location /questroom/socket.io/ {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_read_timeout 75s;
  proxy_send_timeout 75s;
  proxy_buffering off;
}
```

หลังยืนยันว่า websocket ต่อได้ ให้เปลี่ยนทั้ง server และ client เป็น websocket-only:

```js
transports: ["websocket"]
```

### วิธีตรวจสอบหลังแก้

เปิด Chrome DevTools > Network แล้ว filter:

```text
socket.io
```

ต้องเห็น:

```text
transport=websocket
```

ไม่ควรเห็น request จำนวนมากที่เป็น:

```text
transport=polling
```

### ผลต่อ gameplay

Gameplay เหมือนเดิม ผู้เล่นยังเห็นกัน realtime เหมือนเดิม แต่ request ลดลงมาก

### ความเสี่ยง

ถ้า nginx websocket config ยังไม่ถูก แล้วปิด polling ทันที ผู้เล่นจะต่อ socket ไม่ได้ ดังนั้นต้อง deploy แบบ:

1. แก้ nginx
2. ตรวจ websocket
3. ค่อยปิด polling fallback

## 2. Movement บันทึกลง DB ถี่เกินไป

### จุดในโค้ด

- `src/components/GameShell.jsx`
  - `moveSelf()`
  - มี `fetch("/api/player/me", { method: "PATCH" })` หลังเดิน
  - debounce 240ms
- `src/app/api/player/me/route.js`
  - `PATCH`
- `src/lib/player.js`
  - `updateMemberPosition()`

### ปัญหา

ตอนเดิน client ส่ง movement ผ่าน socket อยู่แล้ว:

```js
socketRef.current?.emit("player:move", payload);
```

แต่หลังจากนั้นยังมี `PATCH /api/player/me` เพื่อบันทึกตำแหน่งลง MongoDB ด้วย debounce 240ms

ถ้าผู้เล่น 100 คนเดินพร้อมกัน:

- เกิด DB write จำนวนมาก
- แต่ละ write ต้อง auth session, parse request, connect DB, update document
- backend return `normalizeMember(member)` แบบเต็ม
- client ไม่ได้ใช้ response นี้จริงจัง

นี่เป็นหนึ่งในตัวกิน DB และ request ที่หนักที่สุด เพราะ movement เป็น action ที่เกิดบ่อยมาก

### วิธีแก้แบบคง behavior เดิม

แยก movement เป็น 2 ระดับ:

1. Realtime position ใช้ socket เท่านั้น
2. Persisted position ใช้ save แบบช้า ๆ เพื่อจำตำแหน่งตอนกลับเข้าเกม

แนวทางที่แนะนำ:

- ตัด `PATCH /api/player/me` ออกจากทุก movement click
- เก็บ `lastPersistedPositionRef`
- save position ทุก 30-60 วินาทีถ้าตำแหน่งเปลี่ยนจริง
- save ตอนเปลี่ยน stage
- save ตอน page hide หรือ before unload แบบ best effort

ตัวอย่าง logic:

```js
// Movement realtime
socketRef.current?.emit("player:move", payload);

// Persistence แยกเป็น interval ช้า ๆ
useEffect(() => {
  if (!isAuthed) return;
  const interval = window.setInterval(() => {
    const position = latestPositionRef.current;
    if (!positionChangedEnough(position, lastSavedPositionRef.current)) return;

    lastSavedPositionRef.current = position;
    fetch(withBasePath("/api/player/me/position"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ position })
    }).catch(() => {});
  }, 60_000);

  return () => window.clearInterval(interval);
}, [isAuthed]);
```

หรือถ้าต้องการแก้น้อยที่สุด:

- เปลี่ยน debounce จาก `240ms` เป็น `30_000ms`
- และห้ามส่งซ้ำถ้าตำแหน่งห่างจากเดิมน้อย

### Backend ควรแก้ด้วย

`updateMemberPosition()` ตอนนี้ return `normalizeMember(member)` แบบเต็ม ควรเปลี่ยนเป็น:

```js
return member ? { ok: true, position: nextPosition } : null;
```

หรือถ้าจำเป็นต้องส่ง member:

```js
return member ? normalizeMemberInteraction(member) : null;
```

และ query ควร select เฉพาะ field ที่จำเป็น หรือใช้ `updateOne`:

```js
await Member.updateOne(
  { discord_id: String(discordId || "") },
  {
    $set: {
      roomPosition: {
        x: nextPosition.x,
        y: nextPosition.y,
        updatedAt: new Date()
      }
    }
  }
);
```

### ผลต่อ gameplay

- ผู้เล่นยังเดินและเห็นกัน realtime เหมือนเดิม เพราะ socket ยังอยู่
- ตำแหน่งหลัง refresh อาจเก่ากว่าเล็กน้อย ถ้า save ทุก 30-60 วินาที
- ความแม่นยำของ persisted position ไม่สำคัญเท่า realtime gameplay

### ผลด้าน performance

ลด DB write จาก movement ได้มากที่สุดจุดหนึ่ง

## 3. `/api/player/me` Polling ทุก 15 วินาที

### จุดในโค้ด

- `src/components/GameShell.jsx`
  - initial fetch `/api/player/me`
  - interval fetch ทุก 15 วินาที
- `src/app/api/player/me/route.js`
- `src/lib/player.js`
  - `getMemberByDiscordId()`

### ปัญหา

ทุก 15 วินาที client ทุกคนจะเรียก `GET /api/player/me`

100 คน = ประมาณ 400 requests ต่อนาที เฉพาะ endpoint นี้

แต่ทุก request ต้อง:

- `getServerSession(authOptions)`
- connect DB
- ensure levels
- query `Member`
- normalize member
- return JSON

แม้จะใช้ projection แบบ `MEMBER_INTERACTION_SELECT` แล้ว แต่ยังเป็น request ที่เกิดตลอดเวลา

### วิธีแก้แบบคง behavior เดิม

ใช้ event-driven update แทน polling:

- ตอนซื้อของ route ส่ง `member` กลับมาอยู่แล้ว
- ตอนรับเควส route ส่ง `member` กลับมาอยู่แล้ว
- ตอนส่งเควส route ส่ง `member` กลับมาอยู่แล้ว
- ตอน gamble/hint/reward ก็ส่ง `member` กลับมาอยู่แล้ว

ดังนั้นให้ client update member จาก response ของ action แทนการ polling ถี่

ปรับ polling เป็น:

- initial load ตอนเข้าเกม: คงไว้
- refresh ตอน tab กลับมา visible: คงไว้
- interval: เปลี่ยนเป็น 60-120 วินาที หรือปิดไปก่อน

ตัวอย่าง:

```js
const MEMBER_REFRESH_INTERVAL_MS = 120_000;
```

และเพิ่มเงื่อนไข:

```js
if (document.visibilityState === "hidden") return;
if (recentActionUpdatedMemberRef.current) return;
```

### ถ้าต้อง sync reward

ไม่ควรดึง member ทั้งก้อนทุก 15 วิเพื่อเช็ก reward

ทางเลือก:

1. ใช้ socket event `member:reward`
2. สร้าง endpoint เบา เช่น `/api/player/reward-status`
3. เช็กเฉพาะตอนผู้เล่นทำ action ที่มีโอกาสให้ reward

### ผลต่อ gameplay

แทบไม่เปลี่ยน เพราะ action สำคัญยัง update member ทันทีจาก response

### ผลด้าน performance

ลด read DB และ session decode ต่อเนื่อง

## 4. `/api/player/rooms` บังคับ reload levels ทุกครั้ง

### จุดในโค้ด

- `src/components/GameShell.jsx`
  - `fetch("/api/player/rooms")` ทุก 60 วินาที
- `src/app/api/player/rooms/route.js`
- `src/lib/player.js`
  - `getAvailableLevels()`
  - `ensureLevels({ force: true })`

### ปัญหา

`getAvailableLevels()` บังคับ force reload:

```js
await ensureLevels({ force: true });
```

ทำให้ทุก client ที่เรียก `/api/player/rooms` จะ query `levels` จาก DB ใหม่ แม้ข้อมูล levels ไม่ได้เปลี่ยนบ่อย

100 คน = 100 requests ต่อนาทีที่บังคับอ่าน levels ใหม่

### วิธีแก้

เปลี่ยนเป็นใช้ cache ปกติ:

```js
export async function getAvailableLevels({ force = false } = {}) {
  await connectDb();
  await ensureLevels({ force });
  return cachedLevels || [];
}
```

ใน route ปกติใช้:

```js
const levels = await getAvailableLevels();
```

เฉพาะ admin route ที่แก้ level ค่อยใช้:

```js
await getAvailableLevels({ force: true });
```

ปรับ TTL:

```js
const LEVEL_CACHE_TTL_MS = 5 * 60 * 1000;
```

จากเดิม 15 วินาที เป็น 5 นาที หรือ 10 นาที

### Client ควรแก้ด้วย

ถ้า rooms/levels ไม่เปลี่ยนระหว่างเล่นบ่อย:

- โหลดครั้งเดียวตอนเข้าเกม
- เอา interval ทุก 60 วินาทีออก
- หรือเพิ่มเป็นทุก 5 นาที

### ผลต่อ gameplay

ห้องและ stage ยังเหมือนเดิม ถ้ามี admin เปลี่ยน level สด ๆ ผู้เล่นอาจเห็นช้าลงตาม TTL แต่ปกติไม่ใช่ปัญหา

## 5. Room Snapshot และ `room:peek`

### จุดในโค้ด

- `src/components/GameShell.jsx`
  - `room:peek` ทุก 10 วินาทีเมื่อดูห้องอื่น
- `server.js`
  - `socket.on("room:peek")`

### ปัญหา

นี่ไม่หนักเท่า movement หรือ polling fallback แต่ถ้าผู้เล่นจำนวนมากเปิดดูห้องอื่นพร้อมกัน จะเกิด room snapshot ซ้ำ ๆ

ปัจจุบัน snapshot จำกัด visible players แล้ว ถือว่าดี แต่ยังสามารถลดได้

### วิธีแก้

- ส่ง `room:peek` เฉพาะตอนเปลี่ยนห้อง
- interval จาก 10 วินาทีเป็น 30-60 วินาที
- ถ้า socket room มี update อยู่แล้ว ให้ใช้ patch แทน snapshot
- cache room peek result ต่อ stage ประมาณ 5-10 วินาทีใน memory

### ผลต่อ gameplay

ตอนดูห้องอื่นข้อมูลอาจอัปเดตช้าลงเล็กน้อย แต่ไม่กระทบผู้เล่นในห้องจริง

## 6. Social Status Polling

### จุดในโค้ด

- `src/components/GameShell.jsx`
  - `GET /api/player/social-status` ทุก 60 วินาที
- `src/app/api/player/social-status/route.js`
- `src/lib/player.js`
  - `getSocialQuestStatus()`
  - `loadSocialActivity()`

### ปัญหา

ทุก user เช็ก social unread ทุก 60 วินาที

`loadSocialActivity()` มี cache 10 วินาทีแล้ว ถือว่าช่วยได้ แต่ยังต้อง:

- auth session ทุก request
- query viewer `socialLastSeenAt`
- filter social activity
- return notifications

เมื่อผู้เล่น 100 คน จะกลายเป็น background traffic ตลอดเวลา

### วิธีแก้

เปลี่ยนจาก polling ตลอดเวลาเป็น:

- fetch เมื่อเปิด Global Quest modal
- fetch เมื่อ tab กลับมา visible
- interval ทุก 3-5 นาทีแทน 60 วินาที
- ใช้ socket `social:notification` ที่มีอยู่แล้วสำหรับแจ้ง realtime

เพราะใน `server.js` มี:

```js
socket.broadcast.emit("social:notification", ...)
```

ดังนั้น polling social status ไม่จำเป็นต้องถี่

### ผลต่อ gameplay

notification realtime ยังได้ผ่าน socket ส่วน unread count อาจ update ช้าลงถ้า miss event แต่ไม่กระทบ gameplay หลัก

## 7. Quest Templates และ Hint Templates

### จุดในโค้ด

- `src/components/GameShell.jsx`
  - fetch `/api/quest-templates?difficulty=...`
  - fetch `/api/hint-templates`
- `src/app/api/quest-templates/route.js`
- `src/app/api/hint-templates/route.js`

### ปัญหา

Quest/hint templates เป็นข้อมูล static-ish แต่ client fetch เมื่อ NPC visit บางแบบ ถ้ามี NPC visit พร้อมกันเยอะ จะเกิด request burst

### วิธีแก้

ฝั่ง client:

- cache quest templates แยกตาม difficulty
- cache hint templates ตลอด session

ฝั่ง server:

- เพิ่ม in-memory cache 5-10 นาที
- route ส่ง `Cache-Control` ถ้าข้อมูลไม่ได้ personalize

ตัวอย่าง:

```js
return NextResponse.json(
  { quests },
  { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" } }
);
```

ถ้า admin แก้ template ผ่าน PUT ให้ invalidate cache

### ผลต่อ gameplay

NPC quest/hint ยังสุ่มเหมือนเดิม แต่ไม่ต้อง query DB ซ้ำ ๆ

## 8. Social/Global Quest ใช้ `npcQuestSubmissions` ฝังใน `Member`

### จุดในโค้ด

- `src/models/Member.js`
  - `npcQuestSubmissions: [NpcQuestSubmissionSchema]`
- `src/lib/player.js`
  - `submitNpcQuest()`
  - `submitChallenge()`
  - `getGlobalQuestPosts()`
  - `loadSocialActivity()`
  - `reactToGlobalQuestPost()`

### ปัญหา

ปัจจุบัน submission ของทุกคนถูก push เข้า array ใน document `Member`

ข้อเสีย:

- `Member` document โตขึ้นเรื่อย ๆ
- ทุกครั้งที่ save member อาจมี payload/document ใหญ่ขึ้น
- social feed ต้อง aggregate จาก `Member` แล้ว `$unwind` submissions
- reaction ต้องหา member จาก `"npcQuestSubmissions.id"` แล้วแก้ array
- ถ้า submission เยอะ performance จะลดลงเรื่อย ๆ ตามอายุระบบ

### วิธีแก้ระยะยาว

แยก collection ใหม่:

```js
QuestSubmission {
  id: String,
  authorDiscordId: String,
  authorName: String,
  authorUsername: String,
  authorAvatar: String,
  title: String,
  description: String,
  difficulty: String,
  reward: Number,
  npcType: String,
  npcName: String,
  npcCharacter: String,
  source: String,
  evidence: {
    url: String,
    pathname: String,
    contentType: String,
    size: Number,
    originalName: String
  },
  postText: String,
  likes: [String],
  dislikes: [String],
  submittedAt: Date,
  approvedAt: Date,
  visible: Boolean,
  createdAt: Date,
  updatedAt: Date
}
```

Indexes:

```js
QuestSubmissionSchema.index({ submittedAt: -1 });
QuestSubmissionSchema.index({ authorDiscordId: 1, submittedAt: -1 });
QuestSubmissionSchema.index({ visible: 1, submittedAt: -1 });
QuestSubmissionSchema.index({ source: 1, submittedAt: -1 });
QuestSubmissionSchema.index({ id: 1 }, { unique: true });
```

### เปลี่ยน flow

เดิม:

```js
member.npcQuestSubmissions.push(submission);
await member.save();
```

ใหม่:

```js
await QuestSubmission.create({
  ...submission,
  authorDiscordId: discordId,
  visible: true
});

await Member.updateOne(
  { discord_id: discordId },
  {
    $set: { npcQuest: null },
    $inc: { coin: reward }
  }
);
```

หมายเหตุ: ปัจจุบัน `coin` เป็น string ทำให้ `$inc` ใช้ตรง ๆ ไม่ได้ ควร migration ให้ `coin` เป็น Number หรือใช้ aggregation pipeline update

### Profile modal

เดิม profile อ่าน `member.socialQuestSubmissions`

ใหม่ query:

```js
QuestSubmission.find({
  authorDiscordId: discordId,
  visible: true
})
.sort({ submittedAt: -1 })
.limit(12)
```

### Global feed

เดิมใช้ aggregation unwind จาก Member

ใหม่:

```js
QuestSubmission.find({ visible: true })
  .sort({ submittedAt: -1 })
  .limit(50)
  .lean()
```

### Reaction

เดิมแก้ array ใน Member

ใหม่:

```js
await QuestSubmission.updateOne(
  { id: postId },
  {
    $pull: { likes: viewerId, dislikes: viewerId },
    ...(reaction === "like" ? { $addToSet: { likes: viewerId } } : {}),
    ...(reaction === "dislike" ? { $addToSet: { dislikes: viewerId } } : {})
  }
);
```

ต้องระวังว่า Mongo update ไม่สามารถมี `$pull` และ `$addToSet` กับ field เดียวกันใน object เดียวบางรูปแบบได้ อาจต้องใช้ 2 operations หรือ aggregation pipeline update

### ผลต่อ gameplay

Global Quest, profile posts, likes/dislikes ยังทำงานเหมือนเดิม แต่ query เร็วขึ้นและ Member ไม่โตไม่หยุด

### Migration

1. สร้าง `QuestSubmission` model
2. เขียน script migrate จาก `Member.npcQuestSubmissions`
3. route ใหม่อ่านจาก collection ใหม่
4. ช่วง transition อาจ fallback อ่านของเก่าด้วย
5. หลังมั่นใจแล้วหยุด push เข้า Member

## 9. Upload Evidence กิน RAM

### จุดในโค้ด

- `src/app/api/player/npc-quest/upload/route.js`
  - `Readable.from(Buffer.from(await file.arrayBuffer())).pipe(uploadStream)`

### ปัญหา

เมื่อใช้ GridFS fallback ระบบอ่านไฟล์ทั้งก้อนเข้า memory ก่อนเขียนลง GridFS

เช่น:

- GridFS max 8MB
- 20 คน upload พร้อมกัน
- เฉพาะ buffer ไฟล์อาจใช้มากกว่า 160MB
- รวม overhead ของ multipart, Node, Mongoose, Next อาจสูงกว่านั้นมาก

ถ้าใช้ 100MB ผ่าน Blob/R2 ไม่ควรผ่าน server body โดยตรง

### วิธีแก้

Production ควรใช้ Cloudflare R2 direct upload เป็น default:

- client ขอ presigned URL
- client upload ตรงไป R2
- server แค่ validate metadata ตอน submit quest

ถ้า R2 ไม่ config:

- ห้าม fallback GridFS ใน production
- หรือจำกัด `GRIDFS_MAX_UPLOAD_MB=2`

เพิ่ม env:

```env
REQUIRE_DIRECT_UPLOAD=true
GRIDFS_MAX_UPLOAD_MB=2
```

ใน route:

```js
if (process.env.REQUIRE_DIRECT_UPLOAD === "true" && !isR2Configured() && !process.env.BLOB_READ_WRITE_TOKEN) {
  return NextResponse.json({ error: "direct_upload_not_configured" }, { status: 503 });
}
```

### ถ้าจำเป็นต้องใช้ GridFS

ควร stream file โดยไม่ `arrayBuffer()` ทั้งก้อน แต่ใน Next App Router `request.formData()` มักทำให้ไฟล์ถูก materialize แล้ว จึงไม่เหมาะกับไฟล์ใหญ่บน server เดียว

คำแนะนำคือ:

- ใช้ R2 direct สำหรับ production
- ใช้ GridFS เฉพาะ local/dev หรือไฟล์เล็กมาก

### ผลต่อ gameplay

ผู้เล่นยัง upload evidence ได้เหมือนเดิม แต่ server RAM ไม่พุ่งจากไฟล์

## 10. NPC Timer และ NPC Config DB Access

### จุดในโค้ด

- `server.js`
  - `socketPersonalTimer`
  - `getLevelConfig()`
  - `pickWeightedNpcForStage()`
  - `enrichNpcForStage()`
  - `setPersistedNpcCycle()`

### ปัญหา

NPC cycle ต่อ socket ใช้ timer ใน memory ถือว่าโอเคสำหรับ 100 คน แต่มี DB access ที่เกิดตอน:

- restore cycle ตอน join
- schedule cycle
- persist pending NPC
- NPC elapsed แล้วสุ่ม stage config
- shop NPC ต้องอ่าน `npcShop`

ถ้าผู้เล่น 100 คน reconnect พร้อมกัน หรือ NPC spawn พร้อมกัน จะเกิด DB burst

### วิธีแก้

Cache level config ใน `server.js`:

```js
const levelConfigCache = new Map();
const LEVEL_CONFIG_TTL_MS = 5 * 60 * 1000;

async function getCachedLevelConfig(stage) {
  const key = String(stage || "");
  const cached = levelConfigCache.get(key);
  if (cached && Date.now() - cached.loadedAt < LEVEL_CONFIG_TTL_MS) {
    return cached.value;
  }

  const value = await getLevelConfig(stage, { npcSpawns: 1, npcShop: 1 });
  levelConfigCache.set(key, { value, loadedAt: Date.now() });
  return value;
}
```

แล้วให้ `pickWeightedNpcForStage()` และ `enrichNpcForStage()` ใช้ cache นี้

ลด DB write:

- persist cycle เฉพาะตอน NPC spawn ใหม่
- persist ตอน dismiss
- persist ตอน accept/cancel/submit quest
- persist ตอน disconnect ถ้าจำเป็น
- หลีกเลี่ยงการ write ทุก timer adjustment ที่ไม่สำคัญ

### ผลต่อ gameplay

NPC ยัง spawn ตามรอบเหมือนเดิม แต่ลด DB read/write spike

## 11. Shop/Quest/Gamble/Hint Action ควรใช้ Atomic Update

### จุดในโค้ด

- `src/app/api/player/npc-shop/route.js`
- `src/app/api/player/gamble/route.js`
- `src/app/api/player/hint/route.js`
- `src/lib/player.js`
  - `acceptNpcQuest()`
  - `cancelNpcQuest()`
  - `submitNpcQuest()`
  - `requestChallenge()`
  - `submitChallenge()`

### ปัญหา

หลาย route ทำ pattern:

1. `findOne()`
2. ตรวจ coins/state ใน JS
3. แก้ field บน mongoose document
4. `member.save()`
5. return normalized member

เมื่อ request เยอะ:

- race condition ได้ เช่น ซื้อพร้อมกัน
- save document ใหญ่กว่าที่จำเป็น
- validation/hooks ทำงานเพิ่ม
- DB round trip มากกว่า atomic update

### วิธีแก้

สำหรับ action ที่เป็น coins/item ควรใช้ atomic update ด้วย condition

ตัวอย่างสำหรับ gamble:

```js
const coinValue = {
  $convert: {
    input: { $ifNull: ["$coin", "0"] },
    to: "int",
    onError: 0,
    onNull: 0
  }
};

const member = await Member.findOneAndUpdate(
  {
    discord_id: discordId,
    $expr: { $gte: [coinValue, bet] }
  },
  [
    {
      $set: {
        coin: {
          $toString: {
            $max: [0, { $add: [coinValue, delta] }]
          }
        }
      }
    }
  ],
  {
    new: true,
    projection: MEMBER_INTERACTION_SELECT
  }
);
```

### สำคัญมาก: `coin` ควรเป็น Number

ตอนนี้ `coin` เป็น string ใน `MemberSchema`

```js
coin: { type: String, default: "0" }
```

ทำให้ update เงินต้องแปลง string เป็น int ทุกครั้ง และ query/update ซับซ้อน

ควร migration เป็น:

```js
coin: { type: Number, default: 0 }
```

Migration plan:

1. เพิ่ม field ใหม่ `coinsV2: Number`
2. script แปลงจาก `coin`
3. route อ่าน `coinsV2` เป็นหลัก fallback `coin`
4. route เขียน `coinsV2`
5. หลังนิ่งแล้วเปลี่ยน schema หรือเลิกใช้ `coin`

ถ้าต้องการแก้เร็วแบบไม่ migration ยังใช้ aggregation pipeline update ได้ แต่ระยะยาวควรใช้ Number

### ผลต่อ gameplay

ซื้อของ/พนัน/รับรางวัลยังเหมือนเดิม แต่ระบบจะกัน race condition และ response เร็วขึ้น

## 12. Ranking Query

### จุดในโค้ด

- `src/lib/player.js`
  - `getStageRanking()`

### ปัญหา

Ranking query:

```js
Member.find({
  discord_id: { $exists: true, $ne: "" },
  "profileAchievements.label": level.name
}).lean();
```

จากนั้น sort ใน JS

ถ้ามีสมาชิกเยอะและ achievements เยอะ query นี้จะหนักขึ้น

### วิธีแก้

ระยะสั้น:

- cache ranking ต่อ stage 30-60 วินาที
- limit จำนวนผลลัพธ์ เช่น top 100

ระยะยาว:

- สร้าง collection `StageRanking`
- update ตอน award badge
- query ranking จาก collection แยก

Schema ตัวอย่าง:

```js
StageRanking {
  stageId: String,
  discordId: String,
  name: String,
  username: String,
  avatar: String,
  badgeKind: String,
  gradeValue: Number,
  awardedAt: Date
}
```

Indexes:

```js
StageRankingSchema.index({ stageId: 1, gradeValue: -1, awardedAt: 1 });
StageRankingSchema.index({ stageId: 1, discordId: 1 }, { unique: true });
```

### ผลต่อ gameplay

Ranking ยังเหมือนเดิม แต่เปิด modal ได้เร็วขึ้น

## 13. Member Document มี field ใหญ่ที่ไม่จำเป็นต่อ gameplay

### จุดในโค้ด

- `src/models/Member.js`
  - `evaluations`
  - `certificates`
  - `courseFolders`
  - `projects`
  - `reports`
  - `npcQuestSubmissions`
  - `profileAchievements`

### ปัญหา

`Member` เป็น document รวมหลายระบบ ทั้ง profile, classroom, game, social, submissions

สำหรับ gameplay หลักไม่จำเป็นต้องโหลดทุก field แต่บาง function ยังใช้ `normalizeMember()` เต็ม หรือ query แบบไม่ select

### วิธีแก้

แยก projection ชัดเจน:

- `MEMBER_GAME_SELECT`
- `MEMBER_PROFILE_SELECT`
- `MEMBER_SOCIAL_SELECT`
- `MEMBER_ADMIN_SELECT`

ห้าม route gameplay ใช้ `Member.findOne()` แบบไม่ select ยกเว้นจำเป็นจริง

ตัวอย่าง:

```js
const MEMBER_GAME_SELECT = [
  "_id",
  "discord_id",
  "nick",
  "username",
  "discordData",
  "rank",
  "stage",
  "quest",
  "npcQuest",
  "questChallenge",
  "questReward",
  "roomPosition",
  "coin",
  "shopCooldownT1",
  "shopCooldownT2",
  "shopLimitBreak",
  "shopAssetTickets",
  "ownedAccessories",
  "equippedAccessory",
  "npcCycle",
  "npcVisitId",
  "npcVisitPurchases",
  "tutorial"
].join(" ");
```

### ผลต่อ gameplay

ไม่เปลี่ยน แต่ลด memory ต่อ request และ JSON payload

## 14. MongoDB Connection Pool

### จุดในโค้ด

- `src/lib/db.js`
  - `maxPoolSize` default 20
- `server.js`
  - ใช้ `mongoose.connect()` แยกจาก `src/lib/db.js`

### ปัญหา

ตอนนี้ custom `server.js` มี connection ของตัวเอง และ API route ใช้ `src/lib/db.js` อีกตัวหนึ่ง โดยใช้ mongoose global เดียวกันแต่ connect logic แยกกัน

ถ้า request เยอะมาก pool 20 อาจไม่พอ หรือถ้า DB ช้า pool เต็มจน action สำคัญต้องรอ

### วิธีแก้

หลังลด request storm แล้วค่อย tune pool:

```env
MONGODB_MAX_POOL_SIZE=50
MONGODB_MIN_POOL_SIZE=5
MONGODB_SERVER_SELECTION_TIMEOUT_MS=3000
MONGODB_SOCKET_TIMEOUT_MS=20000
```

แต่ห้ามแก้ด้วยการเพิ่ม pool อย่างเดียว เพราะถ้า request storm ยังอยู่ การเพิ่ม pool อาจย้ายภาระไปทำให้ MongoDB หนักกว่าเดิม

ควรทำตามลำดับ:

1. ลด request/write
2. cache static data
3. tune pool
4. scale process

### Monitoring ที่ควรดู

- MongoDB active connections
- operation latency
- slow query
- Node RSS memory
- event loop lag
- nginx upstream response time

## 15. 502 Bad Gateway

### สาเหตุที่เป็นไปได้ในระบบนี้

1. Node process crash จาก RAM สูง
2. Node process ถูก OOM killer kill
3. upstream timeout เพราะ DB queue ค้าง
4. nginx websocket config ไม่ถูก
5. Next/Auth route ค้างเพราะ process busy
6. upload ใหญ่ทำให้ memory spike

### วิธีแก้ infra

nginx:

```nginx
proxy_connect_timeout 10s;
proxy_send_timeout 75s;
proxy_read_timeout 75s;
```

process manager:

- ใช้ PM2 หรือ systemd restart อัตโนมัติ
- ตั้ง memory limit ที่เหมาะสม
- เก็บ log stdout/stderr

PM2 ตัวอย่าง:

```bash
pm2 start server.js --name questroom --max-memory-restart 1G
pm2 save
```

เพิ่ม health endpoint:

```text
GET /api/health
```

ควรตอบ:

```json
{
  "ok": true,
  "uptime": 12345,
  "memory": {},
  "db": "connected"
}
```

แล้วให้ nginx/load balancer ใช้ตรวจ health

## Rollout Plan

## Phase 0: ตรวจวัดก่อนแก้

เป้าหมาย: ยืนยันว่า request หนักมาจากจุดไหน

Checklist:

- เปิด DevTools ดู `/socket.io` ว่าเป็น websocket หรือ polling
- ดู nginx access log นับ endpoint ที่ยิงเยอะสุด
- ดู Node memory
- ดู MongoDB slow query
- ดูจำนวน request ต่อนาที
- ดูจำนวน upload พร้อมกัน

คำสั่งฝั่ง server ที่ควรใช้:

```bash
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log
pm2 logs questroom
pm2 monit
```

## Phase 1: ลด request storm ทันที

ทำรายการนี้ก่อน เพราะกระทบ performance มากและแก้ง่าย:

1. แก้ nginx websocket
2. ปิด Socket.IO polling หลังยืนยัน websocket
3. เอา DB write ตอนเดินออก หรือ throttle เป็น 30-60 วินาที
4. ลด `/api/player/me` polling เป็น 120 วินาที หรือ refresh เฉพาะ visible
5. เพิ่ม `/api/player/rooms` interval เป็น 5 นาที หรือโหลดครั้งเดียว
6. social status interval เป็น 3-5 นาที หรือ fetch ตอนเปิด modal

Expected result:

- HTTP request ลดลงมาก
- DB write ลดลงมาก
- ซื้อของ/รับเควส/ส่งเควสตอบเร็วขึ้น เพราะ DB queue ว่างขึ้น

## Phase 2: Cache static/game config

1. `ensureLevels()` TTL 5-10 นาที
2. `getAvailableLevels()` ไม่ force reload
3. cache quest templates
4. cache hint templates
5. cache level config ใน `server.js` สำหรับ NPC spawn/shop

Expected result:

- ลด DB read ซ้ำ
- NPC visit และ shop ไม่ query config บ่อยเกินไป

## Phase 3: Upload hardening

1. Require R2 direct upload ใน production
2. จำกัด GridFS fallback 2MB หรือปิด production
3. เพิ่ม error message ถ้า direct upload ยังไม่ config
4. monitor upload latency และ memory

Expected result:

- RAM ไม่ spike จาก file upload
- ลดโอกาส Node OOM และ 502

## Phase 4: Social data migration

1. สร้าง `QuestSubmission`
2. migrate `Member.npcQuestSubmissions`
3. เปลี่ยน global feed/profile/reaction ไปอ่าน collection ใหม่
4. หยุด push submission เข้า Member
5. เก็บ fallback ชั่วคราวระหว่าง migration

Expected result:

- Member document เล็กลง
- social feed เร็วขึ้น
- save member เร็วขึ้น
- รองรับ submission จำนวนมากในระยะยาว

## Phase 5: Atomic action routes

1. shop ใช้ atomic update
2. gamble ใช้ atomic update
3. hint ใช้ atomic update
4. reward ใช้ atomic update
5. accept/cancel/submit quest ลด full document save
6. migrate `coin` จาก string เป็น number

Expected result:

- action สำคัญเร็วขึ้น
- race condition ลดลง
- DB write เบาลง

## Performance Target สำหรับ 100 Players

หลังทำ Phase 1-3 ควรตั้งเป้า:

- Socket transport เป็น websocket 100%
- ไม่มี `/socket.io` polling traffic ใน production
- Movement ไม่เขียน DB ต่อ click
- `/api/player/me` ไม่เกิน 1 request ต่อ user ต่อ 60-120 วินาที
- DB write จาก movement ใกล้ 0
- action API p95 ต่ำกว่า 500ms-1000ms
- Node memory stable ไม่โตเรื่อย ๆ
- upload ไม่ทำให้ Node RSS พุ่ง
- nginx error log ไม่มี upstream timeout ต่อเนื่อง

## Endpoint Priority

แก้ตามลำดับนี้:

1. `/socket.io`
2. `PATCH /api/player/me`
3. `GET /api/player/me`
4. `GET /api/player/rooms`
5. `GET /api/player/social-status`
6. `/api/player/npc-quest/upload`
7. `/api/player/global`
8. `/api/player/profile`
9. `/api/player/ranking`
10. `/api/player/npc-shop`, `/api/player/gamble`, `/api/player/hint`, `/api/player/npc-quest`

## Systems That Are Less Necessary or Can Be Reduced

ระบบที่ไม่ควรทำงานถี่ในช่วง gameplay หลัก:

- Persist position every movement
- Social unread polling ทุก 60 วินาที
- Rooms/levels reload ทุก 60 วินาที
- Room peek snapshot ทุก 10 วินาที
- Quest/hint template fetch ทุก NPC visit
- GridFS upload fallback ใน production
- Ranking/global feed query แบบสดทุกครั้งโดยไม่มี cache

ไม่ได้แปลว่าต้องลบทิ้ง แต่ควรเปลี่ยนเป็น on-demand, cached, throttled, หรือ event-driven

## Quick Win Patch List

รายการแก้เร็วที่สุด:

1. `server.js`
   - เปลี่ยน Socket.IO transports เป็น websocket-only หลัง nginx พร้อม
   - cache level config สำหรับ NPC

2. `src/components/GameShell.jsx`
   - เปลี่ยน Socket.IO transports เป็น websocket-only
   - เอา `PATCH /api/player/me` ออกจาก `moveSelf`
   - เพิ่ม position save interval 60 วินาที
   - เพิ่ม `/api/player/me` refresh interval เป็น 120 วินาที
   - เอา `/api/player/rooms` polling ออก หรือเพิ่มเป็น 5 นาที
   - social status interval 5 นาที
   - cache quest/hint templates

3. `src/lib/player.js`
   - `getAvailableLevels()` ไม่ force reload
   - `updateMemberPosition()` ใช้ `updateOne` และ return payload เบา
   - ranking/social cache เพิ่ม

4. `src/app/api/player/npc-quest/upload/route.js`
   - require direct upload in production
   - lower GridFS max size

## Risk Notes

- ปิด polling ก่อน nginx websocket พร้อม จะทำให้ socket ต่อไม่ได้
- ลด `/api/player/me` polling แล้วต้องมั่นใจว่าทุก action สำคัญ `applyMember(data.member)` ครบ
- ตัด movement DB write แล้วตำแหน่งหลัง refresh อาจเก่ากว่าเล็กน้อย ต้องมี periodic save
- แยก `QuestSubmission` ต้อง migration ระวังข้อมูล post/like/dislike หาย
- เปลี่ยน `coin` เป็น Number ต้อง migration และตรวจทุก route ที่อ่าน/เขียน coin

## Recommended First Implementation Order

ถ้าต้องทำให้เร็วที่สุดโดยไม่เปลี่ยนโครงใหญ่:

1. ตรวจและแก้ websocket/nginx
2. ปิด polling fallback
3. ตัด movement DB write
4. ลด `/api/player/me` polling
5. แก้ `getAvailableLevels()` cache
6. ลด social/rooms interval
7. จำกัด upload fallback

เมื่อทำครบชุดนี้ เกมควรรองรับ 100 คนได้ดีขึ้นมาก โดยระบบซื้อของ รับเควส ส่งเควส ยังทำงานเหมือนเดิม เพราะยังใช้ API เดิมและ update member จาก response เดิม

