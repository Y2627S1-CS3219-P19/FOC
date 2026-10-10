import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { MAILPIT_URL } from '../config';
import { useWallet } from '../errands';

export function HomePage() {
  const { user, login, claims } = useAuth();
  const { wallet } = useWallet();

  if (!user) {
    return (
      <div className="stack narrow" style={{ margin: '24px auto' }}>
        <span className="brand-mark" style={{ width: 52, height: 52, fontSize: '1.6rem', borderRadius: 14 }}>
          T
        </span>
        <h1>Errands, run by people already walking that way.</h1>
        <p className="muted">Ask a classmate to grab your coffee, print or parcel. Pay in credits, not cash.</p>
        <div className="row wrap">
          <Link className="button primary" to="/register">
            Create account
          </Link>
          <button onClick={() => login('/board')}>Log in</button>
        </div>
        <p className="small muted">
          Every new student starts with credits. They circulate on campus only: they can't be bought, cashed out or sent off-platform. Use
          your @u.nus.edu email to sign up.
        </p>
        <p className="small muted">
          Dev: verification and password-reset emails arrive in Mailpit at <a href={MAILPIT_URL}>{MAILPIT_URL}</a>.
        </p>
      </div>
    );
  }

  return (
    <div className="stack">
      <h1>Hi, {claims?.preferred_username}</h1>
      <div className="grid-2">
        <div className="card stack">
          <span className="eyebrow">Available credits</span>
          <span className="credits-big">{wallet?.availableBalance ?? '—'}</span>
          <span className="muted">
            {wallet ? `${wallet.reservedBalance} held for open errands · ${wallet.totalBalance} total` : 'Loading your wallet…'}
          </span>
          <Link to="/credits" className="small">
            See every credit movement →
          </Link>
        </div>
        <div className="card soft stack">
          <Link className="button primary big" to="/errands/new">
            Request an errand
          </Link>
          <Link className="button big" to="/board">
            Earn credits nearby
          </Link>
          <Link className="button big" to="/errands">
            My errands
          </Link>
        </div>
      </div>
    </div>
  );
}
