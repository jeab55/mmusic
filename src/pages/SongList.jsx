import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import AppLayout from "@/components/AppLayout";
import ImportManifestDialog from "@/components/ImportManifestDialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtDuration } from "@/lib/format";
import { Plus, FileUp, Music, Check, Minus, Clock3 } from "lucide-react";

const STEPS = [
  ['song', 'เพลง'], ['story', 'เรื่อง'], ['shots', 'ช่องภาพ'],
  ['images', 'ภาพ'], ['check', 'ตรวจ'], ['video', 'วิดีโอ'],
];

function StepIcon({ done }) {
  if (done === 'done') return <Check className="w-3.5 h-3.5 text-green-500" />;
  if (done) return <Clock3 className="w-3.5 h-3.5 text-amber-500" />;
  return <Minus className="w-3.5 h-3.5 text-muted-foreground/50" />;
}

function SongCard({ song, shots, onOpen }) {
  const st = song.step_status || {};
  const total = shots.length;
  const have = shots.filter((s) => s.status === 'มีภาพ' || s.status === 'ผ่าน').length;
  const cover = song.cover_url || (shots.find((s) => s.thumb_url || s.image_url) || {}).thumb_url || '';

  return (
    <Card className="overflow-hidden cursor-pointer hover:border-primary/60 transition-colors" onClick={onOpen}>
      <div className="aspect-video bg-muted flex items-center justify-center overflow-hidden">
        {cover
          ? <img src={cover} alt={song.title} className="w-full h-full object-cover" loading="lazy" />
          : <Music className="w-10 h-10 text-muted-foreground/40" />}
      </div>
      <div className="p-4 space-y-2">
        <div>
          <div className="font-semibold leading-tight">{song.title}</div>
          {song.story_title && <div className="text-sm text-muted-foreground leading-tight">{song.story_title}</div>}
        </div>
        <div className="text-xs text-muted-foreground">ความยาว {fmtDuration(song.duration_sec)}{total ? ` · ภาพ ${have}/${total}` : ''}</div>
        <div className="flex items-center gap-2 flex-wrap pt-1">
          {STEPS.map(([k, label]) => {
            const v = k === 'images' ? (total && have === total ? 'done' : (have ? 'partial' : '')) : (st[k] || '');
            return (
              <span key={k} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <StepIcon done={v === 'partial' ? 'partial' : v} /> {label}
              </span>
            );
          })}
        </div>
        <Button size="sm" className="w-full mt-1" onClick={(e) => { e.stopPropagation(); onOpen(); }}>ทำต่อ</Button>
      </div>
    </Card>
  );
}

export default function SongList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);

  const { data: songs = [], isLoading } = useQuery({
    queryKey: ['songs'],
    queryFn: async () => {
      const all = await base44.entities.Song.list('-created_at');
      return all.filter((s) => !s.is_deleted);
    },
  });
  const { data: shots = [] } = useQuery({
    queryKey: ['all-shots'],
    queryFn: () => base44.entities.Shot.list(),
  });

  const shotsBySong = {};
  for (const sh of shots) {
    (shotsBySong[sh.song_id] = shotsBySong[sh.song_id] || []).push(sh);
  }

  return (
    <AppLayout actions={
      <>
        <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
          <FileUp className="w-4 h-4 mr-1" /> นำเข้าจาก manifest
        </Button>
        <Button size="sm" onClick={() => navigate('/settings')} title="เพลงใหม่ (เฟส 4 — ตอนนี้ใช้นำเข้า manifest)" disabled>
          <Plus className="w-4 h-4 mr-1" /> เพลงใหม่
        </Button>
      </>
    }>
      <h1 className="text-2xl font-bold font-display mb-4">เพลงทั้งหมด</h1>
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-64 rounded-xl" />)}
        </div>
      ) : songs.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <Music className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p>ยังไม่มีเพลง — กด "นำเข้าจาก manifest" เพื่อเริ่มเพลงแรก</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {songs.map((s) => (
            <SongCard key={s.id} song={s} shots={shotsBySong[s.id] || []} onOpen={() => navigate('/song/' + s.id)} />
          ))}
        </div>
      )}

      <ImportManifestDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={(songId) => {
          queryClient.invalidateQueries({ queryKey: ['songs'] });
          queryClient.invalidateQueries({ queryKey: ['all-shots'] });
          if (songId) navigate('/song/' + songId);
        }}
      />
    </AppLayout>
  );
}
