# QuestRoomWeb API System Analysis

วันที่วิเคราะห์: 2026-06-04

## สรุปภาพรวม

ระบบตอนนี้ optimize จากเดิมไปมากแล้ว จุดที่เคยทำให้ server หน่วงหนักที่สุดคือ movement/request ถี่และ asset โหลดซ้ำ ตอนนี้ movement หลักย้ายไป Socket.IO แบบ websocket-only, API background ลดความถี่ลง, position save ถูก throttle, static template/level/ranking มี cache และ asset local มี WebP + immutable cache header แล้ว

สำหรับผู้เล่น 100 คน baseline ตอนนี้ควรรับได้ดีกว่าเดิมมาก ถ้าไม่มีระบบใหม่เพิ่ม polling ถี่ๆ กลับเข้ามา แต่ยังมี endpoint ที่ต้องจับตาเป็นพิเศษคือ social/global feed, friends list, profile และ upload เพราะเกี่ยวข้องกับ aggregate, external service, list payload และ media

## Flow การส่งข้อมูลปัจจุบัน

| Flow | Endpoint/Event | Trigger | ความถี่ปัจจุบัน | Performance status |
| --- | --- | --- | --- | --- |
| โหลดข้อมูลผู้เล่น | `GET /api/player/me` | เข้าเกม + background refresh | ทุก 120s เฉพาะ tab visible | ดีขึ้นมาก แต่ยังเป็น authenticated DB route |
| save position | `PATCH /api/player/me` | snapshot position | ทุก 60s เมื่อ position เปลี่ยนจริง | ดี, response เล็ก |
| movement realtime | socket `player:move` | ผู้เล่นขยับ | server throttle 90ms | ดี, ไม่เขียน DB ทุก move |
| room patch | socket `players:patch` | batch movement | batched/volatile | ดี, ส่ง delta เฉพาะคนที่เปลี่ยน |
| room snapshot | `GET /api/player/room?stage=` | เปลี่ยนหรือเปิดห้อง | on-demand | ดีถ้าไม่เรียกซ้ำถี่ |
| ดูห้องอื่น | socket `room:peek` | viewing other room | 60s | รับได้ |
| rooms list | `GET /api/player/rooms` | background | 300s | ดี |
| social unread | `GET /api/player/social-status` | background + visibility | 300s | รับได้เพราะมี social activity cache |
| mark seen | `POST /api/player/social-status` | เปิด social modal | on-action | ดี |
| quest templates | `GET /api/quest-templates` | NPC quest UI | client + server cached | ดี |
| hint templates | `GET /api/hint-templates` | hint UI | client + server cached | ดี |
| ranking | `GET /api/player/ranking` | เปิด ranking modal | on-demand + TTL cache | ดีขึ้น แต่ควรไม่ auto refresh |
| global feed | `GET /api/player/global` | เปิด global modal | on-demand + cache | ยังหนักสุดถ้าถูกเรียกถี่ |
| friends | `GET /api/player/friends` | เปิด friends modal | on-demand + cache | หนักได้เพราะเรียก bot server ภายนอก |
| profile | `GET /api/player/profile?id=` | คลิก profile | on-demand | ควบคุมด้วย `submissionLimit: 12` แล้ว |
| ซื้อ/รับ/ส่ง quest | action APIs | ผู้เล่นกด | on-action | รับได้ถ้าไม่ refetch full state |
| upload evidence | `/api/player/npc-quest/upload` | ส่งไฟล์ | direct storage preferred | ต้องระวัง media ผ่าน server |
| assets/images | `/assets/*.webp` | browser render | cached immutable | ดี |
| music | `/assets/bgmusic.mp3` | user audio | preload none + cache | cache ดี แต่ไฟล์ยังใหญ่ |

## ปริมาณ Request โดยประมาณที่ 100 คน

ถ้าผู้เล่น 100 คน active พร้อมกันและไม่มีใคร spam action:

- `GET /api/player/me`: ประมาณ 50 requests/minute จาก interval 120s
- `PATCH /api/player/me`: สูงสุดประมาณ 100 requests/minute ถ้าทุกคนขยับต่อเนื่องและครบ 60s
- `GET /api/player/rooms`: ประมาณ 20 requests/minute จาก interval 300s
- `GET /api/player/social-status`: ประมาณ 20 requests/minute จาก interval 300s
- `room:peek`: เฉพาะคนที่ดูห้องอื่น ถ้า 100 คนดูห้องอื่นพร้อมกันจะประมาณ 100 socket emits/minute
- Movement socket: เป็น event ถี่ที่สุด แต่ถูก throttle ที่ server 90ms และส่งแบบ delta/batch ไม่ใช่ API/DB write

ตัวเลขนี้ถือควบคุมได้มากกว่าเดิม จุดที่ต้องระวังคือ action burst เช่น 100 คนเปิด global/friends พร้อมกัน หรือส่งไฟล์พร้อมกัน เพราะ endpoint กลุ่มนี้หนักกว่า background refresh มาก

## จุดหนักที่ยังต้องระวัง

### 1. `/api/player/global`

สาเหตุที่หนัก:

- ใช้ Mongo aggregate และ `$unwind` `npcQuestSubmissions`
- ต้องคำนวณ visibility, like/dislike, challenge visibility และ sort recent posts
- ถ้า class ไม่ใช่ `all` จะพึ่ง `getClassFriends()` ก่อน ทำให้ chain หนักขึ้น

สถานะตอนนี้:

- มี cache global posts และ pending request dedupe
- จำกัดผลลัพธ์ 50 posts
- เรียกแบบ on-demand จาก modal

เงื่อนไขที่ควรรักษา:

- ห้ามเรียก endpoint นี้เป็น background polling
- ถ้าจะเพิ่ม infinite scroll ให้ใช้ cursor/page limit และ cache ต่อ class
- ถ้า submissions โตมาก ควรพิจารณาแยก collection `social_posts` แทนการ unwind จาก member ทุกครั้ง

### 2. `/api/player/friends`

สาเหตุที่หนัก:

- อาจเรียก bot server ภายนอก `BOT_SERVER_URL`
- มี timeout และ fallback DB แต่ถ้าคนเปิดพร้อมกันเยอะจะรอ external service

สถานะตอนนี้:

- มี class friends cache, pending dedupe และ timeout
- เรียกเฉพาะ modal

เงื่อนไขที่ควรรักษา:

- ห้าม refresh อัตโนมัติถี่
- เพิ่ม cache TTL ถ้า bot server ช้า
- ถ้าใช้บ่อยมาก ควร sync attendance/class roster เป็น background job แยก ไม่เรียก external service จาก user request ทุกครั้ง

### 3. `/api/player/profile`

สาเหตุที่อาจหนัก:

- ดึง member + submissions สำหรับ profile
- ถ้า submissions เยอะมาก payload โตได้

สถานะตอนนี้:

- จำกัด `submissionLimit: 12`
- ไม่ส่ง owned accessories ของคนอื่น

เงื่อนไขที่ควรรักษา:

- ห้ามเพิ่ม full submission history ใน profile response
- ถ้าต้องดูประวัติทั้งหมด ให้ทำ paginated endpoint แยก

### 4. `/api/player/me`

สาเหตุที่ต้องระวัง:

- เป็น authenticated route และเป็น background route ของผู้เล่นทุกคน
- ถ้าลด interval กลับไป 5-15s จะกลับไปเกิด request storm

สถานะตอนนี้:

- refresh ทุก 120s เฉพาะ tab visible
- PATCH position ทุก 60s เฉพาะเมื่อเปลี่ยนจริง และ response เล็ก

เงื่อนไขที่ควรรักษา:

- อย่าผูกระบบ realtime ใหม่กับ `/api/player/me`
- action endpoint ควร return delta/member interaction ที่จำเป็น ไม่ใช่บังคับ refetch `/api/player/me` ต่อทุก action

### 5. Socket.IO movement/presence

สาเหตุที่เป็น hot path:

- 100 คนขยับพร้อมกันทำให้ event เยอะกว่า API อื่นทั้งหมด

สถานะตอนนี้:

- websocket-only default
- server throttle `player:move` 90ms
- room patch batch และส่ง compact movement delta
- disconnect ลบ player ออกจาก room memory แล้ว

เงื่อนไขที่ควรรักษา:

- ห้ามเขียน DB ใน `player:move`
- ห้ามส่ง full profile/submissions ผ่าน `players:patch`
- ห้ามเปิด polling transport เป็น default

### 6. Assets และเพลง

สถานะตอนนี้:

- local images ถูกแปลงเป็น WebP และใช้ `withOptimizedAsset()`
- `/assets/*` มี immutable cache header
- `bgmusic.mp3` preload เป็น none และ cache ได้

จุดที่ยังควร optimize:

- `bgmusic.mp3` ยังใหญ่ประมาณ 30.6 MB
- ถ้ามีหลายเพลงควรแยกเป็น track เล็ก 1-5 MB ต่อไฟล์ และโหลดเฉพาะเพลงที่จะเล่น
- ใช้ bitrate ประมาณ 96-128 kbps สำหรับ BGM loop ส่วน SFX ให้สั้นและเล็ก

## กติกาสำหรับระบบใหม่

1. Realtime gameplay ต้องใช้ socket event พร้อม throttle และ compact payload
2. Background API ต้องมี interval อย่างน้อย 60s และควรเป็น 120-300s
3. Modal/list endpoint ต้อง on-demand, cache, dedupe และ limit
4. Action endpoint ต้องยิงเฉพาะตอนผู้เล่นกด และตอบเฉพาะ state ที่เปลี่ยน
5. Static/template/config ต้อง cache ทั้ง client และ server
6. Media/upload ต้องใช้ direct storage/CDN ก่อน server fallback
7. Asset ต้องใช้ WebP/cache immutable และไม่ preload ไฟล์ใหญ่
8. ทุก DB list/aggregate ต้องมี projection, limit, maxTimeMS หรือ cache
9. ทุก change ต้องวัดจำนวน request ที่ผู้เล่น 100 คนจะสร้างต่อนาที
10. ถ้า request ใหม่ทำให้ endpoint หนักเพิ่ม ต้องแก้ flow ไม่ใช่เพิ่ม RAM อย่างเดียว

## Skill.md ที่เพิ่มเข้ามา

เพิ่ม skill สำหรับใช้เป็นกติกาก่อนออกแบบหรือแก้ data flow ใหม่ที่:

- `.codex/skills/api-data-flow-optimization/SKILL.md`

เมื่อมีงานเพิ่ม API, socket, polling, upload, asset loading หรือระบบ sync ใหม่ ให้ใช้ skill นี้เพื่อบังคับ checklist ด้าน frequency, payload, cache, DB query และ load test
