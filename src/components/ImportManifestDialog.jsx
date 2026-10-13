import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, FileJson, FileText } from "lucide-react";

// แยกเนื้อเรื่องแต่ละภาคจากไฟล์ .md ด้วยหัวข้อ "## ภาค …" (ข้อความก่อนตารางของภาคนั้น)
export function splitStoryParts(mdText) {
  const parts = [];
  if (!mdText) return parts;
  const lines = String(mdText).split(/\r?\n/);
  let cur = null;
  const buf = [];
  const flush = () => {
    if (!cur) return;
    // ตัดตาราง/เส้นคั่นทิ้ง เหลือเฉพาะเนื้อเรื่องก่อนตาราง
    let text = buf.join('\n');
    const tblIdx = text.search(/^\s*\|/m);
    if (tblIdx >= 0) text = text.slice(0, tblIdx);
    parts.push({ part_no: cur.no, title: cur.title, story_text: text.trim() });
  };
  const thNum = { '๑':'1','๒':'2','๓':'3','๔':'4','๕':'5','๖':'6','๗':'7','๘':'8','๙':'9','๐':'0' };
  const toAr = (s) => String(s).replace(/[๐-๙]/g, (c) => thNum[c] || c);
  for (const line of lines) {
    const m = line.match(/^##\s+ภาค\s+([0-9๐-๙]+)\s*(.*)$/);
    if (m) {
      flush();
      cur = { no: parseInt(toAr(m[1]), 10), title: ('ภาค ' + m[1] + ' ' + (m[2] || '')).trim() };
      buf.length = 0;
    } else if (cur) {
      buf.push(line);
    }
  }
  flush();
  return parts;
}

// แปลง entries ของ manifest → แถว Shot
export function manifestToShots(manifest) {
  const entries = (manifest && manifest.entries) || [];
  return entries.map((e) => {
    const pid = String(e.prompt_id || '');
    const slot = parseInt((pid.split('_')[1] || '0'), 10);
    const isLib = e.source === 'library';
    return {
      seq_no: e.no,
      part_no: e.part,
      slot_no: slot,
      file_key: pid,
      t0: e.t0, t1: e.t1,
      lyric_text: e.lyric || '',
      beat_th: e.beat_th || '',
      source: isLib ? 'library' : 'gpt',
      library_asset_id: null,
      library_path: e.library_path || '',
      scene_en: e.scene_en || '',
      generation_prompt: e.generation_prompt || '',
      ref_ids: [],
      image_url: '',
      thumb_url: '',
      status: isLib ? 'มีภาพ' : 'รอภาพ',
      qa_note: '',
      synced_to_pc: 0,
    };
  });
}

// ดึงชื่อเพลงและความยาวจากสตริง เช่น "ยอดพระกัณฑ์ไตรปิฎก (5:54)"
function parseSongTitle(s) {
  const str = String(s || '').trim();
  const m = str.match(/^(.*?)\s*\((\d+):(\d{2})\)\s*$/);
  if (m) return { title: m[1].trim(), duration_sec: parseInt(m[2], 10) * 60 + parseInt(m[3], 10) };
  return { title: str, duration_sec: 0 };
}

export default function ImportManifestDialog({ open, onOpenChange, onImported }) {
  const { toast } = useToast();
  const [manifest, setManifest] = useState(null);
  const [storyParts, setStoryParts] = useState([]);
  const [characters, setCharacters] = useState([]);
  const [styleLock, setStyleLock] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const readJson = (file) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => { try { res(JSON.parse(r.result)); } catch (e) { rej(new Error('ไฟล์ JSON อ่านไม่ได้: ' + file.name)); } };
    r.onerror = () => rej(new Error('อ่านไฟล์ไม่สำเร็จ'));
    r.readAsText(file);
  });
  const readText = (file) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error('อ่านไฟล์ไม่สำเร็จ'));
    r.readAsText(file);
  });

  const pickManifest = async (f) => {
    setErr('');
    if (!f) return;
    try {
      const j = await readJson(f);
      if (!j.entries || !j.entries.length) throw new Error('manifest ไม่มี entries');
      setManifest(j);
    } catch (e) { setErr(e.message); }
  };
  const pickStory = async (f) => {
    if (!f) return;
    const t = await readText(f);
    setStoryParts(splitStoryParts(t));
  };
  const pickChars = async (f) => {
    if (!f) return;
    const j = await readJson(f);
    setCharacters(j.characters || []);
  };
  const pickStyle = async (f) => {
    if (!f) return;
    setStyleLock(await readJson(f));
  };

  const doImport = async () => {
    if (!manifest) return;
    setBusy(true); setErr('');
    try {
      const { title, duration_sec } = parseSongTitle(manifest.song);
      const titleTh = String(manifest.title_th || '');
      const storyTitle = titleTh.includes('—') ? titleTh.split('—').slice(1).join('—').trim() : titleTh;
      const shots = manifestToShots(manifest);
      const payload = {
        song: {
          title: title || titleTh,
          story_title: storyTitle,
          duration_sec,
          images_per_min: 20,
          step_status: { song: 'done', story: storyParts.length ? 'done' : '', shots: 'done', images: '', check: '', video: '' },
          is_deleted: 0,
        },
        parts: storyParts,
        shots,
        characters,
        styleLock,
      };
      const { data } = await base44.functions.invoke('importManifest', payload);
      const have = shots.filter((s) => s.status === 'มีภาพ').length;
      toast({ title: `นำเข้าแล้ว ${data.shots} ช่อง (มีภาพ ${have}/${data.shots})` });
      onOpenChange(false);
      setManifest(null); setStoryParts([]); setCharacters([]); setStyleLock(null);
      onImported && onImported(data.song_id);
    } catch (e) {
      setErr(e.message || 'นำเข้าไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const counts = manifest ? manifest.counts : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>นำเข้าจาก manifest</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>prompt-manifest.json (จำเป็น)</Label>
            <Input type="file" accept=".json" onChange={(e) => pickManifest(e.target.files[0])} />
            {manifest && (
              <p className="text-sm text-muted-foreground">
                <FileJson className="inline w-4 h-4 mr-1" />
                {manifest.title_th} — {counts ? `${counts.images} ช่อง · ${counts.parts} ภาค (คลัง ${counts.library} · GPT ${counts.gpt})` : ''}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label>ไฟล์นิยายภาพ .md (เนื้อเรื่องทุกภาค)</Label>
            <Input type="file" accept=".md,.txt" onChange={(e) => pickStory(e.target.files[0])} />
            {storyParts.length > 0 && (
              <p className="text-sm text-muted-foreground"><FileText className="inline w-4 h-4 mr-1" />พบ {storyParts.length} ภาค</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>character-cards.json (ไม่บังคับ)</Label>
            <Input type="file" accept=".json" onChange={(e) => pickChars(e.target.files[0])} />
            {characters.length > 0 && <p className="text-sm text-muted-foreground">{characters.length} ตัวละคร</p>}
          </div>
          <div className="space-y-2">
            <Label>style-lock.json (ไม่บังคับ)</Label>
            <Input type="file" accept=".json" onChange={(e) => pickStyle(e.target.files[0])} />
            {styleLock && <p className="text-sm text-muted-foreground">โหลด style-lock แล้ว</p>}
          </div>
          {err && <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{err}</div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>ยกเลิก</Button>
          <Button onClick={doImport} disabled={!manifest || busy}>
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            นำเข้า
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
