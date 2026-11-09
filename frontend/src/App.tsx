import { useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, userManager } from './auth';
import { RequireAdmin, RequireLogin } from './components';
import { useWallet } from './errands';
import { AdminRoleChangesPage } from './pages/AdminRoleChanges';
import { AdminAuditPage } from './pages/AdminAudit';
import { AdminCreditsPage } from './pages/AdminCredits';
import { AdminFaqTicketsPage } from './pages/AdminFaqTickets';
import { AdminOrdersPage } from './pages/AdminOrders';
import { AdminUsersPage } from './pages/AdminUsers';
import { BoardPage } from './pages/Board';
import { CreditsPage } from './pages/Credits';
import { ErrandDetailPage } from './pages/ErrandDetail';
import { FaqChatWidget } from './pages/FaqChatWidget';
import { FaqPage } from './pages/FaqPage';
import { HomePage } from './pages/Home';
import { MyErrandsPage } from './pages/MyErrands';
import { NewErrandPage } from './pages/NewErrand';
import { ProfilePage } from './pages/Profile';
import { RegisterPage } from './pages/Register';
import { SupplierDetailPage } from './pages/SupplierDetail';
import { SupplierFormPage } from './pages/SupplierForm';
import { SuppliersPage } from './pages/Suppliers';

function Callback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    userManager
      .signinRedirectCallback()
      .then((u) => navigate((u.state as { returnTo?: string } | undefined)?.returnTo ?? '/', { replace: true }))
      .catch((e: Error) => setError(e.message));
  }, [navigate]);
  return error ? <div className="alert alert-error">Login failed: {error}</div> : <p>Finishing login...</p>;
}

/** "12 available · 3 held", refreshed whenever the page changes (e.g. after posting or confirming). */
function CreditPill() {
  const { wallet, refresh } = useWallet();
  const { pathname } = useLocation();
  useEffect(refresh, [pathname, refresh]);
  if (!wallet) return null;
  return (
    <Link to="/credits" className="credit-pill desktop-only" title="Your credits">
      <b>{wallet.availableBalance}</b> available
      {wallet.reservedBalance > 0 && <span className="muted"> · {wallet.reservedBalance} held</span>}
    </Link>
  );
}

/** Phone-only bottom navigation, as in the mobile screens of the design. */
function TabBar() {
  return (
    <nav className="tabbar" aria-label="Main">
      <NavLink to="/board">
        <span className="icon">⌂</span>Board
      </NavLink>
      <NavLink to="/errands" end>
        <span className="icon">☰</span>Errands
      </NavLink>
      <NavLink to="/errands/new">
        <span className="icon">＋</span>Request
      </NavLink>
      <NavLink to="/credits">
        <span className="icon">◎</span>Credits
      </NavLink>
      <NavLink to="/profile">
        <span className="icon">☺</span>Me
      </NavLink>
    </nav>
  );
}

/** Sub-nav shared by all admin pages, so the top bar only needs one "Admin" link. */
function AdminLayout() {
  return (
    <div className="stack">
      <nav className="tabs admin-nav" aria-label="Admin">
        <NavLink to="users">Users</NavLink>
        <NavLink to="role-changes">Role changes</NavLink>
        <NavLink to="credits">Credits</NavLink>
        <NavLink to="orders">Orders</NavLink>
        <NavLink to="audit">Audit log</NavLink>
        <NavLink to="faq-tickets">FAQ tickets</NavLink>
      </nav>
      <Outlet />
    </div>
  );
}

export function App() {
  const { user, isAdmin, login, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const close = () => setMenuOpen(false);
  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand" onClick={close}>
          <span className="brand-mark">T</span>
          Tapau
        </Link>
        <button className="menu-toggle" aria-label="Menu" onClick={() => setMenuOpen(!menuOpen)}>
          ☰
        </button>
        <nav className={menuOpen ? 'open' : ''}>
          {user && (
            <>
              <NavLink to="/board" onClick={close}>
                Board
              </NavLink>
              <NavLink to="/errands" end onClick={close}>
                My errands
              </NavLink>
            </>
          )}
          <NavLink to="/suppliers" onClick={close}>
            Suppliers
          </NavLink>
          {user && (
            <>
              <NavLink to="/credits" onClick={close}>
                Credits
              </NavLink>
              <NavLink to="/faq" onClick={close}>
                FAQ
              </NavLink>
              <NavLink to="/profile" onClick={close}>
                Me
              </NavLink>
            </>
          )}
          {isAdmin && (
            <NavLink to="/admin" onClick={close}>
              Admin
            </NavLink>
          )}
          {user && <CreditPill />}
          {user ? (
            <button onClick={() => logout()}>Log out</button>
          ) : (
            <>
              <NavLink to="/register" onClick={close}>
                Sign up
              </NavLink>
              <button className="primary" onClick={() => login('/board')}>
                Log in
              </button>
            </>
          )}
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/callback" element={<Callback />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/profile" element={<RequireLogin><ProfilePage /></RequireLogin>} />
          <Route path="/board" element={<RequireLogin><BoardPage /></RequireLogin>} />
          <Route path="/errands" element={<RequireLogin><MyErrandsPage /></RequireLogin>} />
          <Route path="/errands/new" element={<RequireLogin><NewErrandPage /></RequireLogin>} />
          <Route path="/errands/:id" element={<RequireLogin><ErrandDetailPage /></RequireLogin>} />
          <Route path="/credits" element={<RequireLogin><CreditsPage /></RequireLogin>} />
          <Route path="/faq" element={<RequireLogin><FaqPage /></RequireLogin>} />
          <Route path="/suppliers" element={<RequireLogin><SuppliersPage /></RequireLogin>} />
          <Route path="/suppliers/new" element={<RequireAdmin><SupplierFormPage /></RequireAdmin>} />
          <Route path="/suppliers/:id" element={<RequireLogin><SupplierDetailPage /></RequireLogin>} />
          <Route path="/suppliers/:id/edit" element={<RequireAdmin><SupplierFormPage /></RequireAdmin>} />
          <Route path="/admin" element={<RequireAdmin><AdminLayout /></RequireAdmin>}>
            <Route index element={<Navigate to="users" replace />} />
            <Route path="users" element={<AdminUsersPage />} />
            <Route path="role-changes" element={<AdminRoleChangesPage />} />
            <Route path="credits" element={<AdminCreditsPage />} />
            <Route path="orders" element={<AdminOrdersPage />} />
            <Route path="audit" element={<AdminAuditPage />} />
            <Route path="faq-tickets" element={<AdminFaqTicketsPage />} />
          </Route>
          <Route path="*" element={<p>Page not found.</p>} />
        </Routes>
      </main>
      {user && <TabBar />}
      {user && <FaqChatWidget />}
    </>
  );
}
