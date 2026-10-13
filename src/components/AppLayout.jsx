import React from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Music, Library, Settings as SettingsIcon, LogOut } from "lucide-react";

// โครงหน้าหลักของ Mmusic — แถบบน: โลโก้ + เมนู + ผู้ใช้
export default function AppLayout({ children, actions }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const navCls = ({ isActive }) =>
    "px-3 py-2 rounded-lg text-sm font-medium transition-colors " +
    (isActive ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/50");

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2 font-bold text-lg font-display">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-primary text-primary-foreground">
              <Music className="w-4 h-4" />
            </span>
            Mmusic
          </Link>
          <nav className="flex items-center gap-1 ml-4">
            <NavLink to="/" end className={navCls}>เพลง</NavLink>
            <NavLink to="/library" className={navCls}>
              <span className="inline-flex items-center gap-1"><Library className="w-4 h-4" /> คลังภาพ</span>
            </NavLink>
            <NavLink to="/settings" className={navCls}>
              <span className="inline-flex items-center gap-1"><SettingsIcon className="w-4 h-4" /> ตั้งค่า</span>
            </NavLink>
          </nav>
          <div className="flex-1" />
          {actions}
          <span className="hidden sm:inline text-xs text-muted-foreground">{user?.email || ''}</span>
          <Button variant="ghost" size="icon" title="ออกจากระบบ" onClick={() => logout(false)}>
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
