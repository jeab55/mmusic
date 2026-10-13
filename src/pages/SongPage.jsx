import React from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import AppLayout from "@/components/AppLayout";
import StoryboardTab from "@/components/StoryboardTab";
import { LyricsTab, StoryTab, CharactersTab, CheckTab, VideoTab } from "@/components/songTabs";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtDuration } from "@/lib/format";
import { ArrowLeft } from "lucide-react";

export default function SongPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: song, isLoading } = useQuery({
    queryKey: ['song', id],
    queryFn: () => base44.entities.Song.get(id),
  });
  const { data: shots = [] } = useQuery({
    queryKey: ['shots', id],
    queryFn: () => base44.entities.Shot.filter({ song_id: id }, 'seq_no'),
    enabled: !!song,
  });
  const { data: parts = [] } = useQuery({
    queryKey: ['parts', id],
    queryFn: async () => (await base44.entities.StoryPart.filter({ song_id: id }, 'part_no')),
    enabled: !!song,
  });
  const { data: lines = [] } = useQuery({
    queryKey: ['lines', id],
    queryFn: () => base44.entities.LyricLine.filter({ song_id: id }, 'idx'),
    enabled: !!song,
  });
  const { data: characters = [] } = useQuery({
    queryKey: ['characters', id],
    queryFn: async () => {
      // ตัวละครของเพลงนี้ + ตัวละครที่แชร์ข้ามเพลง
      const all = await base44.entities.Character.list();
      return all.filter((c) => String(c.song_id) === String(id) || c.shared);
    },
    enabled: !!song,
  });
  const { data: styleLock } = useQuery({
    queryKey: ['stylelock', id],
    queryFn: async () => (await base44.entities.StyleLock.filter({ song_id: id }))[0] || null,
    enabled: !!song,
  });
  const { data: jobs = [] } = useQuery({
    queryKey: ['jobs', id],
    queryFn: () => base44.entities.Job.filter({ song_id: id }, '-created_at', 20),
    enabled: !!song,
    refetchInterval: 15000,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['shots', id] });
    queryClient.invalidateQueries({ queryKey: ['parts', id] });
    queryClient.invalidateQueries({ queryKey: ['characters', id] });
    queryClient.invalidateQueries({ queryKey: ['stylelock', id] });
    queryClient.invalidateQueries({ queryKey: ['jobs', id] });
    queryClient.invalidateQueries({ queryKey: ['all-shots'] });
  };

  if (isLoading) {
    return <AppLayout><Skeleton className="h-8 w-64 mb-4" /><Skeleton className="h-96 rounded-xl" /></AppLayout>;
  }
  if (!song) {
    return <AppLayout><p className="text-muted-foreground">ไม่พบเพลงนี้</p></AppLayout>;
  }

  return (
    <AppLayout actions={
      <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
        <ArrowLeft className="w-4 h-4 mr-1" /> รายการเพลง
      </Button>
    }>
      <div className="mb-4">
        <h1 className="text-2xl font-bold font-display leading-tight">{song.title}</h1>
        {song.story_title && <p className="text-muted-foreground">{song.story_title}</p>}
        <p className="text-sm text-muted-foreground mt-1">ความยาว {fmtDuration(song.duration_sec)}</p>
      </div>

      <Tabs defaultValue="storyboard">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="lyrics">เนื้อเพลง</TabsTrigger>
          <TabsTrigger value="story">เรื่อง</TabsTrigger>
          <TabsTrigger value="storyboard" className="font-semibold">สตอรี่บอร์ด</TabsTrigger>
          <TabsTrigger value="characters">ตัวละคร</TabsTrigger>
          <TabsTrigger value="check">ตรวจ</TabsTrigger>
          <TabsTrigger value="video">วิดีโอ</TabsTrigger>
        </TabsList>
        <div className="mt-4">
          <TabsContent value="lyrics"><LyricsTab song={song} lines={lines} /></TabsContent>
          <TabsContent value="story"><StoryTab parts={parts} onChanged={refresh} /></TabsContent>
          <TabsContent value="storyboard">
            <StoryboardTab song={song} shots={shots} parts={parts} characters={characters} styleLock={styleLock} onChanged={refresh} />
          </TabsContent>
          <TabsContent value="characters">
            <CharactersTab song={song} characters={characters} styleLock={styleLock} onChanged={refresh} />
          </TabsContent>
          <TabsContent value="check"><CheckTab shots={shots} /></TabsContent>
          <TabsContent value="video"><VideoTab song={song} shots={shots} jobs={jobs} /></TabsContent>
        </div>
      </Tabs>
    </AppLayout>
  );
}
