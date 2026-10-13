import React, { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { fmtSec } from "@/lib/format";
import { Copy, ImagePlus, Library, XCircle, Loader2, AlertTriangle, Download } from "lucide-react";

const STATUS_STYLE = {
  'คลัง': 'bg-green-600/15 text-green-500 border-green-600/30',
  'GPT': 'bg-purple-600/15 text-purple-400 border-purple-600/30',
  'รอภาพ': 'bg-muted text-muted-foreground border-border',
  'มีภาพ': 'bg-blue-600/15 text-blue-400 border-blue-600/30',
  'ผ่าน': 'bg-green-600/15 text-green-500 border-green-600/30',
  'ไม่ผ่าน': 'bg-red-600/15 text-red-400 border-red-600/30',
};

export function shotBadges(shot) {
  const out = [];
  if (shot.source === 'library') out.push('คลัง');
  else if (shot.source === 'gpt') out.push('GPT');
  if (shot.status === 'รอภาพ') out.push('รอภาพ');
  if (shot.status === 'ไม่ผ่าน') out.push('ไม่ผ่าน');
  return out;
}

export default function ShotCard({ shot, characters = [], styleApproved = true, uploading, onCopyPrompt, onPickFile, onReject, onDropFiles, onPickLibrary }) {
  const { toast } = useToast();
  const [dragOver, setDragOver] = useState(false);
  const img = shot.thumb_url || shot.image_url;

  const refIds = Array.isArray(shot.ref_ids) ? shot.ref_ids : [];
  const hasCharRefs = refIds.length > 0;

  const handleCopy = () => {
    if (hasCharRefs && !styleApproved) {
      toast({ title: 'ยังไม่อนุมัติ style-lock — คัดลอกให้แล้ว แต่ควรอนุมัติก่อนสร้างภาพ', variant: 'default' });
    } else {
      toast({ title: 'คัดลอกแล้ว — วางใน ChatGPT ได้เลย' });
    }
    onCopyPrompt(shot);
  };

  return (
    <Card
      className={"overflow-hidden transition-colors " + (dragOver ? "border-primary ring-2 ring-primary/40" : "")}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault(); setDragOver(false);
        const files = Array.from(e.dataTransfer.files || []).filter((f) => f.type.startsWith('image/'));
        if (files.length) onDropFiles(shot, files);
      }}
    >
      <div className="aspect-video bg-muted relative flex items-center justify-center overflow-hidden">
        {uploading ? (
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        ) : img ? (
          <img src={img} alt={shot.file_key} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="absolute inset-3 border-2 border-dashed border-muted-foreground/30 rounded-lg flex items-center justify-center text-xs text-muted-foreground text-center px-2">
            ลากภาพมาวางที่นี่
          </div>
        )}
      </div>
      <div className="p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-sm font-semibold">{shot.file_key}</span>
          <span className="text-xs text-muted-foreground">{fmtSec(shot.t0)}–{fmtSec(shot.t1)}</span>
          {shotBadges(shot).map((b) => (
            <Badge key={b} variant="outline" className={"text-[10px] px-1.5 py-0 " + (STATUS_STYLE[b] || '')}>{b}</Badge>
          ))}
        </div>
        {shot.lyric_text && <div className="text-xs text-muted-foreground line-clamp-2">{shot.lyric_text}</div>}
        {shot.beat_th && <div className="text-sm line-clamp-2">{shot.beat_th}</div>}

        {hasCharRefs && (
          <div className="flex items-center gap-1 text-xs text-amber-500">
            <AlertTriangle className="w-3.5 h-3.5" />
            แนบภาพอ้างอิง {refIds.join(', ')} ไปด้วย
          </div>
        )}

        <div className="flex flex-wrap gap-1.5 pt-1">
          {shot.source !== 'library' && shot.generation_prompt && (
            <Button size="sm" variant="secondary" className="h-8 text-xs" onClick={handleCopy}>
              <Copy className="w-3.5 h-3.5 mr-1" /> คัดลอก prompt
            </Button>
          )}
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => onPickFile(shot)}>
            <ImagePlus className="w-3.5 h-3.5 mr-1" /> อัปโหลดภาพ
          </Button>
          {onPickLibrary && (
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => onPickLibrary(shot)}>
              <Library className="w-3.5 h-3.5 mr-1" /> เลือกจากคลัง
            </Button>
          )}
          {(shot.status === 'มีภาพ' || shot.status === 'ผ่าน') && (
            <Button size="sm" variant="ghost" className="h-8 text-xs text-red-400" onClick={() => onReject(shot)}>
              <XCircle className="w-3.5 h-3.5 mr-1" /> ไม่ผ่าน
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
