import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './lib/auth'
import LoadingSpinner from './components/LoadingSpinner'
import GlobalUploadPanel from './components/GlobalUploadPanel'
import SetupPage from './pages/SetupPage'

// Pages
import HomePage from './pages/HomePage'
import AuthPage from './pages/AuthPage'
import FeedPage from './pages/FeedPage'
import TrendingPage from './pages/TrendingPage'
import TopicPage from './pages/TopicPage'
import UserProfilePage from './pages/UserProfilePage'
import PostDetailPage from './pages/PostDetailPage'
import DrivePage from './pages/DrivePage'
import PublicSharePage from './pages/PublicSharePage'
import MySharesPage from './pages/MySharesPage'
import SearchResultsPage from './pages/SearchResultsPage'
import MembershipPage from './pages/MembershipPage'
import BillingResultPage from './pages/BillingResultPage'
import NotificationsPage from './pages/NotificationsPage'
import SettingsPage from './pages/SettingsPage'
import FollowListPage from './pages/FollowListPage'

// Admin pages
import AdminDashboard from './pages/admin/AdminDashboard'
import AdminUsersPage from './pages/admin/AdminUsersPage'
import AdminPostsPage from './pages/admin/AdminPostsPage'
import AdminFilesPage from './pages/admin/AdminFilesPage'
import AdminReportsPage from './pages/admin/AdminReportsPage'
import AdminSettingsPage from './pages/admin/AdminSettingsPage'
import AdminRedeemPage from './pages/admin/AdminRedeemPage'
import AdminStoragePage from './pages/admin/AdminStoragePage'
import AdminMembershipPage from './pages/admin/AdminMembershipPage'
import AdminBillingOrdersPage from './pages/admin/AdminBillingOrdersPage'
import AdminHotSearchPage from './pages/admin/AdminHotSearchPage'
import AdminTopicsPage from './pages/admin/AdminTopicsPage'
import AboutPage from './pages/AboutPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import VerifyEmailPage from './pages/VerifyEmailPage'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth()
  if (isLoading) return <LoadingSpinner className="py-20" />
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <>{children}</>
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, isLoading } = useAuth()
  if (isLoading) return <LoadingSpinner className="py-20" />
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (user?.role !== 'admin') return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  const { isLoading, setupRequired, adminPath } = useAuth()

  if (isLoading) {
    return <LoadingSpinner className="py-20" />
  }

  if (setupRequired) {
    return <SetupPage />
  }

  // Dynamic admin route prefix from setup wizard (e.g. "admin", "admin_seimo", "manage")
  const ap = `/${adminPath}`

  return (
    <>
      <Routes>
        {/* Public routes */}
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<AuthPage />} />
        <Route path="/register" element={<AuthPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/trending" element={<TrendingPage />} />
        <Route path="/search" element={<SearchResultsPage />} />
        <Route path="/topics/:slug" element={<TopicPage />} />
        <Route path="/u/:username" element={<UserProfilePage />} />
        <Route path="/post/:id" element={<PostDetailPage />} />
        <Route path="/share/:token" element={<PublicSharePage />} />
        <Route path="/about" element={<AboutPage />} />

        {/* Protected routes */}
        <Route path="/feed" element={<ProtectedRoute><FeedPage /></ProtectedRoute>} />
        <Route path="/drive" element={<ProtectedRoute><DrivePage /></ProtectedRoute>} />
        {/* /drive/trash is the recycle bin tab inside DrivePage; the route
            renders the same component so direct visits / bookmarks still
            land on the trash view (DrivePage seeds viewMode from pathname). */}
        <Route path="/drive/trash" element={<ProtectedRoute><DrivePage /></ProtectedRoute>} />
        <Route path="/shares" element={<ProtectedRoute><MySharesPage /></ProtectedRoute>} />
        <Route path="/membership" element={<ProtectedRoute><MembershipPage /></ProtectedRoute>} />
        {/* Legacy /wallet redirects to /membership for old links / bookmarks. */}
        <Route path="/wallet" element={<Navigate to="/membership" replace />} />
        <Route path="/billing/success" element={<ProtectedRoute><BillingResultPage variant="success" /></ProtectedRoute>} />
        <Route path="/billing/cancel" element={<ProtectedRoute><BillingResultPage variant="cancel" /></ProtectedRoute>} />
        <Route path="/notifications" element={<ProtectedRoute><NotificationsPage /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
        <Route path="/me/followers" element={<ProtectedRoute><FollowListPage variant="followers" /></ProtectedRoute>} />
        <Route path="/me/following" element={<ProtectedRoute><FollowListPage variant="following" /></ProtectedRoute>} />

        {/* Admin routes — dynamic path from setup config */}
        <Route path={ap} element={<AdminRoute><AdminDashboard /></AdminRoute>} />
        <Route path={`${ap}/users`} element={<AdminRoute><AdminUsersPage /></AdminRoute>} />
        <Route path={`${ap}/posts`} element={<AdminRoute><AdminPostsPage /></AdminRoute>} />
        <Route path={`${ap}/files`} element={<AdminRoute><AdminFilesPage /></AdminRoute>} />
        <Route path={`${ap}/reports`} element={<AdminRoute><AdminReportsPage /></AdminRoute>} />
        <Route path={`${ap}/settings`} element={<AdminRoute><AdminSettingsPage /></AdminRoute>} />
        <Route path={`${ap}/redeem`} element={<AdminRoute><AdminRedeemPage /></AdminRoute>} />
        <Route path={`${ap}/storage`} element={<AdminRoute><AdminStoragePage /></AdminRoute>} />
        <Route path={`${ap}/membership`} element={<AdminRoute><AdminMembershipPage /></AdminRoute>} />
        <Route path={`${ap}/orders`} element={<AdminRoute><AdminBillingOrdersPage /></AdminRoute>} />
        <Route path={`${ap}/hot-search`} element={<AdminRoute><AdminHotSearchPage /></AdminRoute>} />
        <Route path={`${ap}/topics`} element={<AdminRoute><AdminTopicsPage /></AdminRoute>} />

        {/* Block default /admin if custom admin path is set */}
        {adminPath !== 'admin' && (
          <Route path="/admin/*" element={<Navigate to="/" replace />} />
        )}

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {/* 全局上传面板：渲染在 Routes 之外，路由切换不会卸载，保证后台上传不被打断 */}
      <GlobalUploadPanel />
    </>
  )
}
