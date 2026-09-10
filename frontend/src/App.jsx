import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AppShell from '@/components/AppShell'
import UserShell from '@/components/UserShell'
import ChatPage from '@/pages/ChatPage'
import DocumentsPage from '@/pages/DocumentsPage'
import GraphPage from '@/pages/GraphPage'

// Two surfaces on one bundle: "/" is the end-user chat, "/admin" the full
// console. ponytail: UI separation only; nginx basic auth and the API are
// shared. Protect /admin (and /rag, /db) in nginx if the split must be enforced.
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<UserShell />}>
          <Route index element={<ChatPage />} />
        </Route>
        <Route path="/admin" element={<AppShell />}>
          <Route index element={<Navigate to="/admin/chat" replace />} />
          <Route path="chat" element={<ChatPage admin />} />
          <Route path="documents" element={<DocumentsPage />} />
          <Route path="graph" element={<GraphPage />} />
        </Route>
        <Route path="/chat" element={<Navigate to="/" replace />} />
        <Route path="/search" element={<Navigate to="/" replace />} />
        <Route path="/documents" element={<Navigate to="/admin/documents" replace />} />
        <Route path="/graph" element={<Navigate to="/admin/graph" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
