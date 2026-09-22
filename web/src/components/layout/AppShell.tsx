import type { ReactNode } from 'react'
import Navbar from './Navbar'
import Sidebar from './Sidebar'
import MobileBottomNav from './MobileBottomNav'

interface Props {
  children: ReactNode
  hideSidebar?: boolean
}

export default function AppShell({ children, hideSidebar = false }: Props) {
  return (
    <div className="min-h-screen bg-surface">
      <Navbar />
      <div className="flex">
        {!hideSidebar && <Sidebar />}
        <main className="flex-1 min-w-0 pb-20 md:pb-0">
          {children}
        </main>
      </div>
      <MobileBottomNav />
    </div>
  )
}
