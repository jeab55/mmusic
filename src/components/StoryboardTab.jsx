import React, { useMemo, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import ShotCard from "@/components/ShotCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/components/ui/use-toast";
import { makeThumb, isLandscape169 } from "@/lib/image";
import { fileKeyFromName, fmtSec } from "@/lib/format";
import { ChevronDown, Download, HardDriveDownload, ImagePlus } from "lucide-react";

const FILTERS = [
  ['all', 'ทั้งหมด'], ['wait', 'รอภาพ'], ['library', 'คลัง'], ['gpt', 'GPT'], ['fail', 'ไม่ผ่าน'],
];

export default function StoryboardTab({ song, shots, parts, characters, styleLock, onChanged }) {
  const { toast } = useToast();
  const [filter, setFilter] = useState('all');
  const [partFilter, setPartFilter] = useState(0); // 0 = ทุกภาค
  const [uploading, setUploading] = useState({}); // shotId → true
  const [unmatched, setUnmatched] = useState([]); // ไฟล์ที่จับคู่ช่องไม่ได้
  const [multiDrag, setMultiDrag] = useState(false);
  const fileInputRef = useRef(null);
  const pickShotRef = useRef(null);

  const sorted = useMemo(() => shots.slice().sort((a, b) => (a.seq_no || 0) - (b.seq_no || 0)), [shots]);
  const total = sorted.length;
  const have = sorted.filter((s) => s.status === 'มีภาพ' || s.status === 'ผ่าน').length;
  const waitGpt = sorted.filter((s) => s.source === 'gpt' && s.status === 'รอภาพ').length;
  const failed = sorted.filter((s) => s.status === 'ไม่ผ่าน').length;
  const styleApproved = !!(styleLock && styleLock.approved);

  const partNos = useMemo(() => Array.from(new Set(sorted.map((s) => s.part_no))).sort((a, b) => a - b), [sorted]);
  const partTitle = (no) => {
    const p = parts.find((x) => x.part_no === no);
    return p ? p.title : 'ภาค ' + no;
  };
  const partStory = (no) => {
    const p = parts.find((x) => x.part_no === no);
    return p ? (p.story_text || '') : '';
  };

  const matchFilter = (s) => {
    if (partFilter && s.part_no !== partFilter) return false;
    switch (filter) {
      case 'wait': return s.status === 'รอภาพ';
      case 'library': return s.source === 'library';
      case 'gpt': return s.source === 'gpt';
      case 'fail': return s.status === 'ไม่ผ่าน';
      default: return true;
    }
  };

  // ---- อัปโหลดภาพเข้าช่อง (ต้นฉบับ + ภาพย่อ 480px) ----
  const uploadToShot = async (shot, file) => {
    setUploading((u) => ({ ...u, [shot.id]: true }));
    try {
      const thumb = await makeThumb(file, 480);
      if (!isLandscape169(thumb.ratio)) {
        toast({ title: `${shot.file_key}: ภาพไม่ใช่แนวนอน 16:9 — ใส่ให้แล้วแต่ควรตรวจอีกครั้ง`, variant: 'destructive' });
      }
      const up = await base44.integrations.Core.UploadFile({ file });
      const thumbFile = new File([thumb.blob], (file.name || 'thumb') + '.thumb.jpg', { type: 'image/jpeg' });
      const upThumb = await base44.integrations.Core.UploadFile({ file: thumbFile });
      await base44.entities.Shot.update(shot.id, {
        image_url: up.file_url,
        thumb_url: upThumb.file_url,
        status: 'มีภาพ',
        source: shot.source === 'library' ? 'library' : 'gpt',
        synced_to_pc: 0,
      });
      onChanged && onChanged();
    } catch (e) {
      toast({ title: 'อัปโหลดไม่สำเร็จ: ' + (e.message || e), variant: 'destructive' });
    } finally {
      setUploading((u) => ({ ...u, [shot.id]: false }));
    }
  };

  const handleDropFiles = async (shot, files) => {
    await uploadToShot(shot, files[0]);
  };

  const handlePickFile = (shot) => {
    pickShotRef.current = shot;
    fileInputRef.current && fileInputRef.current.click();
  };

  // ---- วางหลายภาพ: จับคู่จากชื่อไฟล์ ภภ_ชช ----
  const handleMultiDrop = (files) => {
    const imgs = files.filter((f) => f.type.startsWith('image/'));
    const notMatched = [];
    let matched = 0;
    for (const f of imgs) {
      const key = fileKeyFromName(f.name);
      const shot = key && sorted.find((s) => s.file_key === key);
      if (shot) { matched++; uploadToShot(shot, f); }
      else notMatched.push(f);
    }
    if (matched) toast({ title: `กำลังอัปโหลด ${matched} ภาพเข้าช่องที่ตรงชื่อ` });
    if (notMatched.length) setUnmatched(notMatched);
  };

  const assignUnmatched = async (file, shotId) => {
    const shot = sorted.find((s) => String(s.id) === String(shotId));
    if (!shot) return;
    setUnmatched((l) => l.filter((x) => x !== file));
    await uploadToShot(shot, file);
  };

  // ---- คัดลอก prompt ----
  const copyPrompt = async (shot) => {
    try {
      await navigator.clipboard.writeText(shot.generation_prompt || '');
    } catch (e) {
      // fallback สำหรับบางเบราว์เซอร์
      const ta = document.createElement('textarea');
      ta.value = shot.generation_prompt || '';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
    }
  };

  // ---- ดาวน์โหลด prompt ที่ยังขาดเป็น .md ----
  const downloadMissingPrompts = () => {
    const missing = sorted.filter((s) => s.source === 'gpt' && (s.status === 'รอภาพ' || s.status === 'ไม่ผ่าน') && s.generation_prompt);
    if (!missing.length) { toast({ title: 'ไม่มี prompt ที่ยังขาด' }); return; }
    let md = `# Prompt ที่ยังขาด — ${song.title}\n\n`;
    for (const s of missing) {
      md += `## ${s.file_key} · ${fmtSec(s.t0)}–${fmtSec(s.t1)} · ${s.beat_th || ''}\n\n${s.generation_prompt}\n\n---\n\n`;
    }
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `prompts-ขาด-${song.title}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ---- ส่งภาพลงเครื่อง (Job pull_images) ----
  const queuePullImages = async () => {
    try {
      await base44.entities.Job.create({ type: 'pull_images', song_id: song.id, params: { song_id: song.id }, status: 'queued', progress: 0 });
      toast({ title: 'สั่งงานการ์ดจอแล้ว — ตัวรันงานจะดึงภาพลงเครื่องเมื่อออนไลน์' });
    } catch (e) {
      toast({ title: 'สร้างงานไม่สำเร็จ: ' + (e.message || e), variant: 'destructive' });
    }
  };

  const rejectShot = async (shot) => {
    const note = window.prompt('เหตุผลที่ไม่ผ่าน (เว้นว่างได้):', shot.qa_note || '');
    if (note === null) return;
    await base44.entities.Shot.update(shot.id, { status: 'ไม่ผ่าน', qa_note: note });
    onChanged && onChanged();
  };

  return (
    <div className="space-y-4">
      {/* หัวหน้า: ตัวนับ + ตัวกรอง + ปุ่ม */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">ภาพครบ {have}/{total}</span>
        <span className="text-sm text-muted-foreground">· รอ GPT {waitGpt} · ไม่ผ่าน {failed}</span>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={downloadMissingPrompts}>
          <Download className="w-4 h-4 mr-1" /> ดาวน์โหลด prompt ที่ยังขาด (.md)
        </Button>
        <Button variant="outline" size="sm" onClick={queuePullImages}>
          <HardDriveDownload className="w-4 h-4 mr-1" /> ส่งภาพลงเครื่อง
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map(([k, label]) => (
          <Button key={k} size="sm" variant={filter === k ? 'default' : 'outline'} className="h-8 text-xs"
            onClick={() => setFilter(k)}>{label}</Button>
        ))}
        <span className="w-px bg-border mx-1" />
        <Button size="sm" variant={partFilter === 0 ? 'default' : 'outline'} className="h-8 text-xs" onClick={() => setPartFilter(0)}>ทุกภาค</Button>
        {partNos.map((p) => (
          <Button key={p} size="sm" variant={partFilter === p ? 'default' : 'outline'} className="h-8 text-xs"
            onClick={() => setPartFilter(p)}>ภาค {p}</Button>
        ))}
      </div>

      {/* พื้นที่วางหลายภาพ */}
      <div
        className={"border-2 border-dashed rounded-xl p-4 text-center text-sm transition-colors " +
          (multiDrag ? "border-primary bg-primary/5 text-foreground" : "border-muted-foreground/30 text-muted-foreground")}
        onDragOver={(e) => { e.preventDefault(); setMultiDrag(true); }}
        onDragLeave={() => setMultiDrag(false)}
        onDrop={(e) => { e.preventDefault(); setMultiDrag(false); handleMultiDrop(Array.from(e.dataTransfer.files || [])); }}
      >
        <ImagePlus className="w-5 h-5 inline mr-2" />
        วางหลายภาพที่นี่ — ตั้งชื่อไฟล์ขึ้นต้นด้วยรหัสช่อง เช่น <span className="font-mono">01_04.png</span> แล้วระบบจะเข้าช่องให้เอง
      </div>

      {/* ไฟล์ที่จับคู่ไม่ได้ */}
      {unmatched.length > 0 && (
        <div className="rounded-xl border border-amber-600/40 bg-amber-600/5 p-3 space-y-2">
          <div className="text-sm font-medium text-amber-500">จับคู่จากชื่อไฟล์ไม่ได้ {unmatched.length} ไฟล์ — เลือกช่องเอง:</div>
          {unmatched.map((f, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="font-mono text-xs flex-1 truncate">{f.name}</span>
              <select className="bg-card border border-border rounded-md px-2 py-1 text-xs"
                defaultValue=""
                onChange={(e) => { if (e.target.value) assignUnmatched(f, e.target.value); }}>
                <option value="" disabled>เลือกช่อง…</option>
                {sorted.map((s) => (
                  <option key={s.id} value={s.id}>{s.file_key} · {s.beat_th || s.lyric_text || ''}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      {/* กลุ่มตามภาค */}
      {partNos.filter((p) => !partFilter || p === partFilter).map((p) => {
        const partShots = sorted.filter((s) => s.part_no === p && matchFilter(s));
        if (!partShots.length) return null;
        return (
          <div key={p} className="space-y-3">
            <Collapsible>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold font-display text-lg">{partTitle(p)}</h3>
                <Badge variant="outline" className="text-xs">{partShots.filter((s) => s.status !== 'รอภาพ').length}/{sorted.filter((s) => s.part_no === p).length}</Badge>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground">
                    <ChevronDown className="w-3.5 h-3.5 mr-1" /> เนื้อเรื่องภาคนี้
                  </Button>
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent>
                <div className="text-sm text-muted-foreground whitespace-pre-wrap bg-card border border-border rounded-lg p-3 mt-2 max-h-64 overflow-y-auto">
                  {partStory(p) || '(ยังไม่มีเนื้อเรื่องภาคนี้)'}
                </div>
              </CollapsibleContent>
            </Collapsible>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {partShots.map((s) => (
                <ShotCard
                  key={s.id}
                  shot={s}
                  characters={characters}
                  styleApproved={styleApproved}
                  uploading={!!uploading[s.id]}
                  onCopyPrompt={copyPrompt}
                  onPickFile={handlePickFile}
                  onReject={rejectShot}
                  onDropFiles={handleDropFiles}
                />
              ))}
            </div>
          </div>
        );
      })}

      {/* input ไฟล์ซ่อนสำหรับปุ่มอัปโหลดทีละช่อง */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files && e.target.files[0];
          const shot = pickShotRef.current;
          if (f && shot) uploadToShot(shot, f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
