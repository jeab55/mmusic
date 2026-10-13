import React, { useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { fmtSec, fmtDuration } from "@/lib/format";
import { Play, Save, CheckCircle2, ImageOff, Repeat2, Expand } from "lucide-react";

/* ---------- แท็บเนื้อเพลง: ตารางบรรทัด + เวลา + เล่นเฉพาะบรรทัด ---------- */
export function LyricsTab({ song, lines }) {
  const audioRef = useRef(null);
  const stopTimer = useRef(null);
  const [playingId, setPlayingId] = useState(null);

  const playLine = (ln) => {
    const a = audioRef.current;
    if (!a || !song.audio_url) return;
    a.currentTime = ln.start_sec || 0;
    a.play();
    setPlayingId(ln.id);
    clearTimeout(stopTimer.current);
    const dur = Math.max(0.3, ((ln.end_sec || 0) - (ln.start_sec || 0)) * 1000);
    stopTimer.current = setTimeout(() => { a.pause(); setPlayingId(null); }, dur);
  };

  return (
    <div className="space-y-3">
      {song.audio_url
        ? <audio ref={audioRef} src={song.audio_url} controls className="w-full h-10" />
        : <p className="text-sm text-muted-foreground">ยังไม่มีไฟล์เสียง (เฟส 4 จะอัปโหลด mp3 ได้)</p>}
      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">ยังไม่มีบรรทัดเนื้อเพลง — การจับเวลาอัตโนมัติ (align) จะมาในเฟส 4</p>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 w-10">#</th>
                <th className="text-left px-3 py-2">เนื้อเพลง</th>
                <th className="text-left px-3 py-2 w-24">ท่อน</th>
                <th className="text-left px-3 py-2 w-28">เวลา</th>
                <th className="w-12"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((ln) => (
                <tr key={ln.id} className="border-t border-border/60">
                  <td className="px-3 py-1.5 text-muted-foreground">{ln.idx}</td>
                  <td className="px-3 py-1.5">
                    <div>{ln.text_th || ln.text_roman}</div>
                    {ln.text_th && ln.text_roman && <div className="text-xs text-muted-foreground">{ln.text_roman}</div>}
                  </td>
                  <td className="px-3 py-1.5"><Badge variant="outline" className="text-xs">{ln.section || '-'}</Badge></td>
                  <td className="px-3 py-1.5 text-xs text-muted-foreground font-mono">{fmtSec(ln.start_sec)}–{fmtSec(ln.end_sec)}</td>
                  <td className="px-2">
                    {song.audio_url && (
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => playLine(ln)}>
                        <Play className={"w-4 h-4 " + (playingId === ln.id ? "text-primary" : "")} />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ---------- แท็บเรื่อง: แก้ story_text ทีละภาค (textarea ล้วน ห้าม HTML) ---------- */
export function StoryTab({ parts, onChanged }) {
  const { toast } = useToast();
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState({});

  const save = async (part) => {
    setSaving((s) => ({ ...s, [part.id]: true }));
    try {
      await base44.entities.StoryPart.update(part.id, { story_text: drafts[part.id] });
      toast({ title: `บันทึก ${part.title} แล้ว` });
      onChanged && onChanged();
    } catch (e) {
      toast({ title: 'บันทึกไม่สำเร็จ', variant: 'destructive' });
    } finally {
      setSaving((s) => ({ ...s, [part.id]: false }));
    }
  };

  if (!parts.length) return <p className="text-sm text-muted-foreground">ยังไม่มีเรื่อง — นำเข้าพร้อมไฟล์นิยายภาพ .md หรือใช้ AI แต่งเรื่อง (เฟส 4)</p>;

  return (
    <div className="space-y-4">
      {parts.map((p) => {
        const val = drafts[p.id] !== undefined ? drafts[p.id] : (p.story_text || '');
        return (
          <Card key={p.id} className="p-4 space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold font-display">{p.title}</h3>
              <div className="flex-1" />
              <Button size="sm" variant="outline" disabled={saving[p.id] || drafts[p.id] === undefined}
                onClick={() => save(p)}>
                <Save className="w-3.5 h-3.5 mr-1" /> {saving[p.id] ? 'กำลังบันทึก…' : 'บันทึก'}
              </Button>
            </div>
            <Textarea
              className="min-h-[160px] text-sm leading-relaxed"
              value={val}
              onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
            />
          </Card>
        );
      })}
    </div>
  );
}

/* ---------- แท็บตัวละคร / Style-lock ---------- */
export function CharactersTab({ song, characters, styleLock, onChanged }) {
  const { toast } = useToast();
  const approve = async () => {
    if (!styleLock) return;
    await base44.entities.StyleLock.update(styleLock.id, { approved: 1, approved_at: new Date().toISOString() });
    toast({ title: 'อนุมัติ style-lock แล้ว' });
    onChanged && onChanged();
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold font-display">Style-lock</h3>
          {styleLock ? (
            styleLock.approved
              ? <Badge className="bg-green-600/15 text-green-500 border-green-600/30" variant="outline"><CheckCircle2 className="w-3 h-3 mr-1" />อนุมัติแล้ว</Badge>
              : <Badge variant="outline" className="text-amber-500 border-amber-600/40">รออนุมัติ</Badge>
          ) : <Badge variant="outline">ยังไม่มี</Badge>}
          <div className="flex-1" />
          {styleLock && !styleLock.approved && <Button size="sm" onClick={approve}>อนุมัติ style-lock</Button>}
        </div>
        {styleLock && (
          <div className="mt-3 space-y-2 text-sm">
            <div><span className="text-muted-foreground">การเรนเดอร์:</span> {styleLock.rendering}</div>
            {Array.isArray(styleLock.forbidden) && styleLock.forbidden.length > 0 && (
              <div><span className="text-muted-foreground">ห้าม:</span> {styleLock.forbidden.join(' · ')}</div>
            )}
          </div>
        )}
      </Card>

      {characters.length === 0 ? (
        <p className="text-sm text-muted-foreground">ยังไม่มีบัตรตัวละคร — นำเข้าพร้อม character-cards.json</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {characters.map((c) => (
            <Card key={c.id} className="p-4 space-y-2">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{c.name}</span>
                {c.shared ? <Badge variant="outline" className="text-xs">ใช้ข้ามเพลง</Badge> : null}
              </div>
              <div className="text-xs text-muted-foreground">{c.role}</div>
              {c.ref_image_url
                ? <img src={c.ref_image_url} alt={c.name} className="w-full aspect-video object-cover rounded-lg" loading="lazy" />
                : <div className="w-full aspect-video rounded-lg bg-muted flex items-center justify-center text-xs text-muted-foreground">ยังไม่มีภาพอ้างอิง</div>}
              <div className="text-sm">{c.appearance_th}</div>
              {c.lock_en && <div className="text-xs text-muted-foreground font-mono bg-muted/50 rounded p-2">{c.lock_en}</div>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- แท็บตรวจ: แผ่นรวมภาพ + รายการปัญหา (เบื้องต้น เฟส 5 จะเต็ม) ---------- */
export function CheckTab({ shots }) {
  const sorted = shots.slice().sort((a, b) => (a.seq_no || 0) - (b.seq_no || 0));
  const missing = sorted.filter((s) => s.status === 'รอภาพ');
  const libCount = {};
  sorted.forEach((s) => { if (s.source === 'library' && s.library_path) libCount[s.library_path] = (libCount[s.library_path] || 0) + 1; });
  const dupes = Object.entries(libCount).filter(([, n]) => n > 1);

  return (
    <div className="space-y-4">
      <div className="space-y-1 text-sm">
        <div className="flex items-center gap-2">
          {missing.length ? <ImageOff className="w-4 h-4 text-amber-500" /> : <CheckCircle2 className="w-4 h-4 text-green-500" />}
          {missing.length ? `ยังไม่มีภาพ ${missing.length} ช่อง: ${missing.slice(0, 10).map((s) => s.file_key).join(', ')}${missing.length > 10 ? ' …' : ''}` : 'ภาพครบทุกช่องแล้ว'}
        </div>
        <div className="flex items-center gap-2">
          {dupes.length ? <Repeat2 className="w-4 h-4 text-amber-500" /> : <CheckCircle2 className="w-4 h-4 text-green-500" />}
          {dupes.length ? `ภาพคลังถูกใช้ซ้ำในเพลงเดียว ${dupes.length} รายการ` : 'ไม่มีภาพคลังที่ใช้ซ้ำ'}
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
        {sorted.map((s) => (
          <div key={s.id} className="relative rounded-lg overflow-hidden border border-border bg-muted aspect-video">
            {(s.thumb_url || s.image_url)
              ? <img src={s.thumb_url || s.image_url} alt={s.file_key} className="w-full h-full object-cover" loading="lazy" />
              : <div className="w-full h-full flex items-center justify-center text-[10px] text-muted-foreground">ว่าง</div>}
            <span className="absolute bottom-0 left-0 bg-background/80 text-[10px] font-mono px-1 rounded-tr">{s.file_key}</span>
            {s.status === 'ไม่ผ่าน' && <span className="absolute top-0 right-0 bg-red-600/80 text-white text-[10px] px-1 rounded-bl">ไม่ผ่าน</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- แท็บวิดีโอ (เฟส 1: แสดงเงื่อนไข + คิวงาน) ---------- */
export function VideoTab({ song, shots, jobs }) {
  const { toast } = useToast();
  const total = shots.length;
  const have = shots.filter((s) => s.status === 'มีภาพ' || s.status === 'ผ่าน').length;
  const ready = total > 0 && have === total;

  const queueRender = async () => {
    try {
      await base44.entities.Job.create({ type: 'render', song_id: song.id, params: { song_id: song.id, formats: ['16x9', '9x16'], fx: true }, status: 'queued', progress: 0 });
      toast({ title: 'สั่งทำวิดีโอแล้ว — ตัวรันงานการ์ดจอจะหยิบงานเมื่อออนไลน์ (เฟส 3)' });
    } catch (e) {
      toast({ title: 'สร้างงานไม่สำเร็จ', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div className="text-sm">ภาพพร้อม {have}/{total}</div>
        <Button disabled={!ready} onClick={queueRender}>
          ทำวิดีโอ (16:9 + 9:16)
        </Button>
        {!ready && <p className="text-xs text-muted-foreground">ปุ่มจะใช้ได้เมื่อภาพครบทุกช่อง</p>}
        {(song.video_16x9_url || song.video_9x16_url) && (
          <div className="text-sm space-y-1">
            {song.video_16x9_url && <div>16:9 — <span className="font-mono text-xs">{song.video_16x9_url}</span></div>}
            {song.video_9x16_url && <div>9:16 — <span className="font-mono text-xs">{song.video_9x16_url}</span></div>}
          </div>
        )}
      </Card>
      {jobs.length > 0 && (
        <Card className="p-4">
          <h3 className="font-semibold mb-2">คิวงานการ์ดจอ</h3>
          <div className="space-y-2">
            {jobs.map((j) => (
              <div key={j.id} className="text-sm flex items-center gap-2">
                <Badge variant="outline">{j.type}</Badge>
                <span className="text-muted-foreground">{j.status}</span>
                {typeof j.progress === 'number' && j.status === 'running' && <span>{Math.round(j.progress * 100)}%</span>}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
