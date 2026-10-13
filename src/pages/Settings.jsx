import React from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import AppLayout from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { Copy, Cpu } from "lucide-react";

const IMAGE_RULES_DEFAULT = [
  'ไม่มีช้าง', 'ไม่ถ่ายมือระยะใกล้', 'ไม่มีทุ่งนาไทย', 'ไม่มีตัวหนังสือในภาพ',
  'พระพุทธเจ้าไม่มีต่างหู', 'มวยผมกลมไม่มียอดแหลม', 'ห่มจีวรเฉียงไหล่ซ้าย',
  'นั่งแล้วมือวางซ้อนบนตัก', 'ซับตัวใหญ่และไม่ใช้สีส้ม',
];

// ตั้งค่า — เฟส 1: กฎภาพ (อ่านอย่างเดียว) + สถานะการ์ดจอ + โทเค็นสำหรับตัวรันงาน
export default function Settings() {
  const { toast } = useToast();

  const { data: heartbeats = [] } = useQuery({
    queryKey: ['heartbeat'],
    queryFn: () => base44.entities.WorkerHeartbeat.list('-updated_at', 5),
    refetchInterval: 30000,
  });

  const now = Date.now();
  const gpu = heartbeats[0];
  const online = gpu && gpu.last_seen && (now - new Date(gpu.last_seen).getTime()) < 90 * 1000;

  const copyToken = async () => {
    let t = '';
    try { t = localStorage.getItem('b55user') || ''; } catch (e) {}
    if (!t) { toast({ title: 'ไม่พบโทเค็น — ลองออกจากระบบแล้วเข้าใหม่', variant: 'destructive' }); return; }
    const conf = JSON.stringify({
      api: window.location.origin,
      token: t,
      worker_id: 'PC-think',
      root: 'C:\\Users\\think\\Downloads\\Claude outputs\\yod_video',
    }, null, 2);
    await navigator.clipboard.writeText(conf);
    toast({ title: 'คัดลอกแล้ว — วางในไฟล์ mmusic_worker.json บน PC' });
  };

  return (
    <AppLayout>
      <h1 className="text-2xl font-bold font-display mb-4">ตั้งค่า</h1>
      <div className="space-y-4 max-w-2xl">
        <Card className="p-4 space-y-2">
          <h3 className="font-semibold flex items-center gap-2"><Cpu className="w-4 h-4" /> สถานะการ์ดจอ</h3>
          <div className="text-sm">
            {online
              ? <span className="text-green-500">● ออนไลน์{gpu.gpu ? ` — ${gpu.gpu}` : ''}{gpu.state === 'busy' ? ' (กำลังทำงาน)' : ' (ว่าง)'}</span>
              : <span className="text-muted-foreground">○ ออฟไลน์ — เปิดตัวรันงานด้วย 01-เปิดตัวรันงานการ์ดจอ.bat บน PC (เฟส 3)</span>}
          </div>
          <Button variant="outline" size="sm" onClick={copyToken}>
            <Copy className="w-4 h-4 mr-1" /> คัดลอกโทเค็นสำหรับตัวรันงาน
          </Button>
        </Card>

        <Card className="p-4 space-y-2">
          <h3 className="font-semibold">จำนวนภาพต่อนาที</h3>
          <p className="text-sm text-muted-foreground">ค่าเริ่มต้น 20 ภาพ/นาที (ตั้งต่อเพลงได้ในเฟส 4)</p>
        </Card>

        <Card className="p-4 space-y-2">
          <h3 className="font-semibold">กฎภาพ (ใช้ต่อท้าย prompt และในหน้าตรวจ)</h3>
          <ul className="text-sm list-disc pl-5 space-y-1 text-muted-foreground">
            {IMAGE_RULES_DEFAULT.map((r) => <li key={r}>{r}</li>)}
          </ul>
          <p className="text-xs text-muted-foreground">แก้ไขกฎได้ในเฟสถัดไป — ตอนนี้ใช้ค่าเริ่มต้นนี้</p>
        </Card>
      </div>
    </AppLayout>
  );
}
