import { useMemo, useState } from "react";

interface AuthViewProps {
  busy: boolean;
  error?: string;
  onSignIn: (email: string, password: string) => Promise<void>;
  onSignUp: (email: string, password: string) => Promise<void>;
}

function passwordStrongEnough(value: string): boolean {
  if (value.length < 10 || value.length > 120) return false;
  return /[a-zA-Z]/.test(value) && /[0-9]/.test(value);
}

export function AuthView({ busy, error, onSignIn, onSignUp }: AuthViewProps) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState<string | undefined>(undefined);

  const isSignup = mode === "signup";
  const canSubmit = useMemo(() => {
    if (!email.trim() || !password) return false;
    if (isSignup && (!passwordStrongEnough(password) || password !== confirm)) return false;
    return true;
  }, [confirm, email, isSignup, password]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(undefined);
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setLocalError("Enter a valid email address.");
      return;
    }
    if (isSignup && !passwordStrongEnough(password)) {
      setLocalError("Password must be 10-120 characters and include letters and numbers.");
      return;
    }
    if (isSignup && password !== confirm) {
      setLocalError("Password confirmation does not match.");
      return;
    }
    if (isSignup) {
      await onSignUp(normalizedEmail, password);
      return;
    }
    await onSignIn(normalizedEmail, password);
  }

  return (
    <div className="auth-shell">
      <section className="auth-card">
        <header className="auth-header">
          <h2>Theia Control Center</h2>
          <p>Sign in to access local memory sources, OpenClaw operations, and emergency controls.</p>
        </header>
        <div className="auth-mode-row" role="tablist" aria-label="Authentication mode">
          <button
            type="button"
            className={mode === "signin" ? "auth-mode-btn active" : "auth-mode-btn"}
            onClick={() => setMode("signin")}
            aria-selected={mode === "signin"}
          >
            Sign In
          </button>
          <button
            type="button"
            className={mode === "signup" ? "auth-mode-btn active" : "auth-mode-btn"}
            onClick={() => setMode("signup")}
            aria-selected={mode === "signup"}
          >
            Create Account
          </button>
        </div>
        <form className="auth-form" onSubmit={submit}>
          <label className="field-col">
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label className="field-col">
            <span>Password</span>
            <input
              type="password"
              autoComplete={isSignup ? "new-password" : "current-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {isSignup ? (
            <label className="field-col">
              <span>Confirm Password</span>
              <input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                required
              />
            </label>
          ) : null}
          <p className="muted-note">
            {isSignup
              ? "Owner is assigned to the first account. Additional accounts receive operator access."
              : "Sessions are local-first and expire automatically."}
          </p>
          {(localError || error) && <div className="feedback error">{localError ?? error}</div>}
          <button type="submit" className="action-btn danger auth-submit-btn" disabled={busy || !canSubmit}>
            {busy ? "Authorizing..." : isSignup ? "Create Account" : "Sign In"}
          </button>
        </form>
      </section>
    </div>
  );
}

