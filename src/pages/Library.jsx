import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import AppLayout from "@/components/AppLayout";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Library as LibraryIcon } from "lucide-react";

// คลังภาพ — เฟส 1 แสดงเท่าที่มีในฐานข้อมูล (การซิงก์ภาพย่อ 941 ภาพมาในเฟส 2)
export default function Library() {
  const [q, setQ] = useState('');
  const { data: assets = [], isLoading } = useQuery({
    queryKey: ['library'],
    queryFn: () => base44.entities.LibraryAsset.list(),
  });

  const filtered = assets.filter((a) =>
    !q || (a.name_th || '').includes(q) || (a.path || '').includes(q) || (a.folder || '').includes(q));

  return (
    <AppLayout>
      <h1 className="text-2xl font-bold font-display mb-4">คลังภาพ</h1>
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="ค้นหาชื่อภาพ เช่น เนบิวลา…"
        className="max-w-md mb-4"
      />
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          {Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="aspect-video rounded-lg" />)}
        </div>
      ) : assets.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <LibraryIcon className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p>คลังยังว่าง — การซิงก์ภาพจากเครื่อง (library_sync) จะมาในเฟส 2</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          {filtered.map((a) => (
            <Card key={a.id} className="overflow-hidden">
              <div className="aspect-video bg-muted">
                {a.thumb_url && <img src={a.thumb_url} alt={a.name_th} className="w-full h-full object-cover" loading="lazy" />}
              </div>
              <div className="p-2">
                <div className="text-xs leading-tight line-clamp-2">{a.name_th || a.path}</div>
                <div className="flex items-center gap-1 mt-1">
                  {a.orientation && <Badge variant="outline" className="text-[10px] px-1 py-0">{a.orientation}</Badge>}
                  <span className="text-[10px] text-muted-foreground">ใช้ {a.used_count || 0} ครั้ง</span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </AppLayout>
  );
}
