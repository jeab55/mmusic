# APP.md — Mmusic (slug: mmusic)

> อ่านไฟล์นี้ก่อนแก้แอป · สร้าง 2026-10-13 โดยคัดลอกโครงสร้างจาก Mnovel (jeab55/mnovel)

## สรุป 1 บรรทัด
แอปทำวิดีโอเพลงแบบนิยายภาพ (เพลง → เรื่อง → ช่องภาพ → ภาพ → ตรวจ → วิดีโอ) React/Vite + base55 บนโฮสต์ mplus.thinkpowers.com · งานหนัก (align/upscale/render) ทำบน PC เจ้าของผ่าน worker ที่ดึง Job จากเว็บ

## ข้อมูลพื้นฐาน
- **URL:** https://mplus.thinkpowers.com/mmusic/ (path-based, VITE_BASE=/mmusic/)
- **ประเภท:** react-vite (repo) — React 18 + Vite + react-router + @tanstack/react-query + radix + Tailwind (โทนเข้มอบอุ่น, ฟอนต์ Sarabun/Noto Serif Thai)
- **repo:** `jeab55/mmusic` · workflow `.github/workflows/deploy.yml` (FTP → Hostinger)
- **API:** same-origin — `window.location.origin + /api.php` (override ด้วย `window.__B55_ORIGIN` ตอน dev)
- **backend:** `mmusicfn.php` วางที่ `public_html/mmusicfn.php` บน mplus (อัปผ่าน hPanel เท่านั้น — WAF บล็อกการเขียน PHP ผ่าน API)
- **uploads:** `public_html/uploads/mmusic/` → `https://mplus.thinkpowers.com/uploads/mmusic/…` (URL คำนวณจากตำแหน่งสคริปต์อัตโนมัติ)

## ฐานข้อมูล (b55_mmusic)
- entities: `song`, `lyricline`, `storypart`, `shot`, `character`, `stylelock`, `libraryasset`, `job`, `workerheartbeat`
- **ห้ามใช้ underscore ในชื่อ entity** · ตารางถูกสร้างอัตโนมัติ (โดย entity.php หรือ mmusicfn.php `ensure_tables`)
- ทุกแถวมี `id, user_email, created_at, updated_at` · scope user (ยกเว้นที่กำหนด SHARED ใน adapter)
- ฟิลด์ JSON เก็บเป็น string: ดู `JSON_FIELDS` ใน adapter — parse เฉพาะฟิลด์ที่ระบุเท่านั้น (**ห้าม parse ทุกฟิลด์** เคยพังใน Mnovel)

## Adapter (`src/api/base44Client.js`)
- โครงเดียวกับ Mnovel: `base44.entities.*` / `functions.invoke` / `integrations.Core` / `auth`
- **op:'filter' ฝั่งเซิร์ฟเวอร์ไม่กรองจริง → adapter ดึง list แล้วกรองฝั่ง client เสมอ**
- list วนหน้า 500 แถวอัตโนมัติ · เทียบเจ้าของข้อมูลด้วย `user_email`
- auth: token `localStorage.b55user` → header `X-Auth` · Google client id ตัวเดียวกับ Mnovel/base55
- **base55 ไม่มี reset password → หน้า login ไม่มีลิงก์ลืมรหัสผ่าน**

## หน้าจอ (routes)
| route | หน้า |
|---|---|
| `/` | รายการเพลง (การ์ด + แถบ 6 ขั้น + นำเข้า manifest) |
| `/song/:id` | หน้าเพลง 6 แท็บ: เนื้อเพลง · เรื่อง · สตอรี่บอร์ด⭐ · ตัวละคร · ตรวจ · วิดีโอ |
| `/library` | คลังภาพ (เฟส 2 ซิงก์ภาพย่อจาก PC) |
| `/settings` | ตั้งค่า + สถานะการ์ดจอ + คัดลอกโทเค็นตัวรันงาน |
| `/login` | เข้าสู่ระบบ (Google / อีเมล) |

## สถานะเฟส
- **เฟส 1 (ชุดนี้):** login · รายการเพลง · นำเข้า manifest (สร้าง Song/StoryPart/Shot/Character/StyleLock) · สตอรี่บอร์ดเต็มรูปแบบ (คัดลอก prompt, ลากภาพวางทีละช่อง/หลายภาพจับคู่จากชื่อไฟล์, ภาพย่อ 480px ฝั่ง browser, ดาวน์โหลด prompt ที่ขาด .md, ปุ่มส่งภาพลงเครื่องสร้าง Job) · mmusicfn.php ครบทุก fn รวมของเฟส 2–3 (libraryUpsert, heartbeat, jobPoll, jobUpdate, shotsForPull, markSynced)
- **เฟส 2:** library_sync (worker) + dialog เลือกจากคลัง
- **เฟส 3:** worker.py --cloud (ดึง Job) — fn ฝั่ง PHP พร้อมแล้ว
- **เฟส 4:** เพลงใหม่ + align + AI แต่งเรื่อง (invokeLLM พร้อมแล้ว)
- **เฟส 5:** ตรวจเต็มรูปแบบ + render

## วิธีแก้ / deploy
- แก้ repo → push main → GitHub Actions → FTP ขึ้น `apps/mmusic/` · **ห้ามแก้ไฟล์บนโฮสต์ตรง ๆ**
- ⚠️ `DEPLOY_DIR` ใน deploy.yml ตั้งเป็น `/domains/mplus.thinkpowers.com/public_html/apps/mmusic/` — **ยืนยัน path จริงก่อน deploy ครั้งแรก** (ดูใน hPanel → โดเมน mplus.thinkpowers.com)
- `mmusicfn.php` อัปผ่าน hPanel File Manager → `public_html/mmusicfn.php` (byte-perfect)
- ต้องมี secret `FTP_PASSWORD` ใน repo
- Google OAuth: เพิ่ม origin `https://mplus.thinkpowers.com` ใน client id `707060721356-…` (Authorized JavaScript origins)
- ลงทะเบียนแอปใน registry ของ mplus: slug `mmusic`, database `b55_mmusic`, publishedUrl `https://mplus.thinkpowers.com/mmusic/`

## ⚠️ Gotchas
- `op:'filter'` ไม่กรอง → adapter กรองฝั่ง client แล้ว ห้ามเรียก filter ตรง ๆ นอก adapter
- ชื่อ entity มี underscore = ตารางใหม่ว่างเปล่า
- ช่องแก้เนื้อเรื่องเป็น textarea ล้วน **ห้ามเก็บ HTML**
- `isOwner` อยู่ระดับบนสุดของผลตอบ `?a=me`
- fn ฝั่ง worker (jobPoll ฯลฯ) ต้องเป็นเจ้าของ — เช็ก `$OWNER_EMAILS` / role ใน mmusicfn.php
- **ห้ามเขียน token/key ลง repo หรือแชต** — worker อ่าน token จาก `mmusic_worker.json` บน PC (หน้า /settings มีปุ่มคัดลอก)

## ค้าง / TODO
- ยืนยัน DEPLOY_DIR + FTP server ของ mplus host ก่อน push ครั้งแรก
- ปุ่ม "เพลงใหม่" ปิดไว้ (รอเฟส 4)
- ทดสอบ e2e หลัง deploy: login → นำเข้า manifest (118 ช่อง) → คัดลอก prompt 01_04 → ลากภาพวาง → รีเฟรชแล้วข้อมูลอยู่
