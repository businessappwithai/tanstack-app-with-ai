/**
 * Login Page - Swiss Clean Design
 *
 * User authentication with email and password
 *
 */

import { useState } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { signIn } from '@/lib/auth';
import { useAuth } from '@/contexts/auth-context';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Loader2, LogIn, AlertCircle, Mail, Lock, Shield } from 'lucide-react';
import {
  ACCESS_IS_SCOPED,
  APP_NAME,
  SEEDED_ACCOUNTS,
  SEEDED_PASSWORD,
  TOTAL_ENTITIES,
  LINE_ITEM_ENTITIES,
} from "@/lib/app-meta";

/**
 * The password field's placeholder mask, built from a code point rather than
 * written as a literal row of bullets.
 *
 * Written literally, it reached the browser as the visible text
 * `\u2022\u2022...` — an escape that had itself been escaped — so the first page
 * of every generated application showed eight escape sequences where the mask
 * should be. It is the only attribute value in these templates that is
 * *entirely* non-ASCII, and the only one that mangles: `placeholder="Value\u2026"`
 * a few files over comes through the same bundle as real UTF-8.
 *
 * Neither the generator, the subpath overlay, nor Bun's own TSX transform of
 * this file does it, so it happens inside the generated project's Vite build.
 * Rather than depend on which step, this leaves no non-ASCII literal and no
 * escape sequence for anything to act on.
 */
const BULLET = String.fromCharCode(0x2022);

export const Route = createFileRoute('/auth/login')({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { refreshSession } = useAuth();
  const [isPending, setIsPending] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsPending(true);

    if (!email || !password) {
      setError('Please enter both email and password');
      setIsPending(false);
      return;
    }

    try {
      const { data, error: signInError } = await signIn(email, password);

      if (signInError || !data) {
        const msg = signInError || 'Invalid email or password';
        setError(msg);
        setIsPending(false);
        return;
      }

      // Persist token so api-client can send Authorization header after hard nav
      const token = (data as Record<string, unknown>)?.token as string | undefined;
      if (token) sessionStorage.setItem('auth_token', token);

      // Full navigation so auth-context re-initializes with the new session cookie
      window.location.href = '/dashboard';
    } catch (err: any) {
      const errorMessage = err?.message || 'An unexpected error occurred';
      setError(errorMessage);
      setIsPending(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-gradient-to-br from-background via-background to-muted/20 flex items-center justify-center p-4">
      {/* The theme is switchable before anyone has signed in. The choice is
          stored per browser rather than on the account, so there is nothing to
          wait for a session for — and the first screen of the application is a
          poor one to have no say over. */}
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md">
        {/* Logo and Title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-lg mb-6">
            <Shield className="w-10 h-10" />
          </div>
          <h1 className="text-3xl font-bold text-foreground mb-2">Welcome Back</h1>
          <p className="text-muted-foreground">Sign in to access {APP_NAME}</p>
        </div>

        {/* Login Form Card */}
        <div className="rounded-2xl border border-border/60 bg-gradient-to-br from-card to-card/50 backdrop-blur-sm p-8 shadow-lg">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Error Message */}
            {error && (
              /* The one place a failed sign-in is reported. A toast beside it said the
                 same thing twice and vanished; this stays beside the fields it is about,
                 and `role="alert"` is what makes a screen reader announce it. */
              <div
                role="alert"
                className="flex items-start gap-3 p-4 rounded-lg bg-destructive/10 border border-destructive/20"
              >
                <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm text-destructive font-medium">Sign in failed</p>
                  <p className="text-sm text-destructive/80 mt-1">{error}</p>
                </div>
              </div>
            )}

            {/* Email Field */}
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium text-foreground">
                Email Address
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10 bg-background/80 backdrop-blur-sm border-border/60"
                  disabled={isPending}
                  autoComplete="email"
                  required
                />
              </div>
            </div>

            {/* Password Field */}
            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-medium text-foreground">
                Password
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  placeholder={BULLET.repeat(8)}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 bg-background/80 backdrop-blur-sm border-border/60"
                  disabled={isPending}
                  autoComplete="current-password"
                  required
                />
              </div>
            </div>

            {/* Remember Me & Forgot Password */}
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="remember"
                  checked={rememberMe}
                  onCheckedChange={(checked) => setRememberMe(checked as boolean)}
                  disabled={isPending}
                />
                <Label
                  htmlFor="remember"
                  className="text-sm font-normal text-muted-foreground cursor-pointer"
                >
                  Remember me
                </Label>
              </div>
              <a
                href="/auth/forgot-password"
                className="text-sm text-primary hover:underline font-medium"
              >
                Forgot password?
              </a>
            </div>

            {/* Submit Button */}
            <Button
              type="submit"
              className="w-full shadow-md shadow-primary/20"
              disabled={isPending}
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                <>
                  <LogIn className="mr-2 h-4 w-4" />
                  Sign In
                </>
              )}
            </Button>
          </form>

          {/* The seeded accounts, one row each.
              A generated application seeds one account per functional role plus
              an administrator who bypasses every restriction the model wrote —
              so an application you can only sign into as the administrator is
              one whose access control you cannot see. The entity count beside
              each address is the invitation to compare two roles, and clicking
              a row fills the form because retyping an address is exactly the
              friction that stops people comparing them.

              This is demonstration data. Change SEEDED_PASSWORD in the seed
              before this runs anywhere real and the list stops being true; the
              seed's own header says the same. */}
          {SEEDED_ACCOUNTS.length > 0 && (
            <>
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border/40"></div>
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-2 bg-card text-muted-foreground bg-gradient-to-r from-card via-card to-card">
                    Seeded accounts
                  </span>
                </div>
              </div>

              <p className="text-sm text-muted-foreground mb-3">
                Password <code className="px-1.5 py-0.5 rounded bg-muted font-mono text-xs">{SEEDED_PASSWORD}</code> for all of them.
                {ACCESS_IS_SCOPED
                  ? " Each role sees only its own entities — pick one to try it."
                  : " Pick one to fill the form."}
                {LINE_ITEM_ENTITIES.length > 0 &&
                  ` Counts include ${LINE_ITEM_ENTITIES.length === 1 ? 'a line item' : 'line items'}, which open from the parent record rather than the sidebar.`}
              </p>

              <ul className="space-y-1.5">
                {SEEDED_ACCOUNTS.map((account) => (
                  <li key={account.email}>
                    <button
                      type="button"
                      onClick={() => {
                        setEmail(account.email);
                        setPassword(SEEDED_PASSWORD);
                      }}
                      className="w-full text-left rounded-md border border-border/60 bg-muted/40 px-3 py-2 transition-colors hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <span className="block text-sm font-semibold text-foreground">{account.role}</span>
                      <span className="block font-mono text-xs text-muted-foreground break-all">{account.email}</span>
                      <span className="block text-xs text-muted-foreground">
                        {account.isAdmin
                          ? `all ${TOTAL_ENTITIES} entities`
                          : `${account.entities} of ${TOTAL_ENTITIES} entities`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>

              <p className="text-center text-xs text-muted-foreground mt-4">
                Any other account is created by an administrator.
              </p>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="text-center mt-6 space-y-2">
          <div>
            <Link
              to="/"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              ← Back to Home
            </Link>
          </div>
          <p className="text-xs text-muted-foreground">
            Built with{' '}
            <a
              href="https://appwithai.org"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors"
            >
              APPWITHAI
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
