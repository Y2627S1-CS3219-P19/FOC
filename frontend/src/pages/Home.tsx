import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { MAILPIT_URL } from '../config';

export function HomePage() {
  const { user, isAdmin, login, claims } = useAuth();
  return (
    <div className="stack">
      <h1>Friend on Campus</h1>
      <p>Ask a fellow student to pick something up for you on campus, or earn credits by delivering for others.</p>
      {user ? (
        <div className="card">
          <p>
            Logged in as <b>{claims?.preferred_username}</b> ({isAdmin ? 'administrator' : 'user'}).
          </p>
          <div className="row">
            <Link className="button primary" to="/suppliers">
              Browse suppliers
            </Link>
            <Link className="button" to="/profile">
              My profile
            </Link>
          </div>
        </div>
      ) : (
        <div className="card">
          <p>Use your @u.nus.edu email to create an account.</p>
          <div className="row">
            <Link className="button primary" to="/register">
              Sign up
            </Link>
            <button onClick={() => login('/suppliers')}>Log in</button>
          </div>
          <p className="muted">
            Dev: verification and password-reset emails arrive in Mailpit at <a href={MAILPIT_URL}>{MAILPIT_URL}</a>.
          </p>
        </div>
      )}
    </div>
  );
}
