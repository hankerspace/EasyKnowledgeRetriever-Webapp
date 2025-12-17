import React from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { MessageSquare, Share2, Menu } from 'lucide-react';
import { cn } from '../lib/utils';
import { Toaster } from 'sonner';

const Layout = () => {
  const location = useLocation();

  const navItems = [
    { path: '/search', label: 'Recherche & Chat', icon: MessageSquare },
    { path: '/graph', label: 'Visualisation Graph', icon: Share2 },
  ];

  return (
    <div className="flex h-screen bg-slate-50">
      <Toaster position="top-right" />
      
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-slate-200 hidden md:flex flex-col">
        <div className="p-6 border-b border-slate-200">
          <h1 className="text-xl font-bold text-slate-900">EasyRAG</h1>
          <p className="text-xs text-slate-500">Knowledge Retriever</p>
        </div>
        
        <nav className="flex-1 overflow-y-auto p-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname.startsWith(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors",
                  isActive 
                    ? "bg-slate-900 text-slate-50" 
                    : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                )}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-14 border-b border-slate-200 bg-white flex items-center px-6 md:hidden">
          <Menu className="w-6 h-6 text-slate-500" />
          <span className="ml-4 font-semibold">EasyRAG</span>
        </header>
        
        <div className="flex-1 overflow-auto p-6">
           <Outlet />
        </div>
      </main>
    </div>
  );
};

export default Layout;
