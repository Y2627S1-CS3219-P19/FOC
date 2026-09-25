import { useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { useAuth, userManager } from './auth';
import { DebugStrip, RequireAdmin, RequireLogin } from './components';
import { AdminRoleChangesPage } from './pages/AdminRoleChanges';
import { AdminUsersPage } from './pages/AdminUsers';
import { HomePage } from './pages/Home';
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

export function App() {
  const { user, isAdmin, login, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const close = () => setMenuOpen(false);
  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand" onClick={close}>
          Friend on Campus
        </Link>
        <button className="menu-toggle" aria-label="Menu" onClick={() => setMenuOpen(!menuOpen)}>
          ☰
        </button>
        <nav className={menuOpen ? 'open' : ''}>
          <NavLink to="/suppliers" onClick={close}>
            Suppliers
          </NavLink>
          {user && (
            <NavLink to="/profile" onClick={close}>
              My profile
            </NavLink>
          )}
          {isAdmin && (
            <>
              <NavLink to="/admin/users" onClick={close}>
                Admin: users
              </NavLink>
              <NavLink to="/admin/role-changes" onClick={close}>
                Admin: role changes
              </NavLink>
            </>
          )}
          {user ? (
            <button onClick={() => logout()}>Log out</button>
          ) : (
            <>
              <NavLink to="/register" onClick={close}>
                Sign up
              </NavLink>
              <button className="primary" onClick={() => login('/suppliers')}>
                Log in
              </button>
            </>
          )}
        </nav>
      </header>
      <DebugStrip />
      <main>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/callback" element={<Callback />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/profile" element={<RequireLogin><ProfilePage /></RequireLogin>} />
          <Route path="/suppliers" element={<RequireLogin><SuppliersPage /></RequireLogin>} />
          <Route path="/suppliers/new" element={<RequireAdmin><SupplierFormPage /></RequireAdmin>} />
          <Route path="/suppliers/:id" element={<RequireLogin><SupplierDetailPage /></RequireLogin>} />
          <Route path="/suppliers/:id/edit" element={<RequireAdmin><SupplierFormPage /></RequireAdmin>} />
          <Route path="/admin/users" element={<RequireAdmin><AdminUsersPage /></RequireAdmin>} />
          <Route path="/admin/role-changes" element={<RequireAdmin><AdminRoleChangesPage /></RequireAdmin>} />
          <Route path="*" element={<p>Page not found.</p>} />
        </Routes>
      </main>
    </>
  );
}
