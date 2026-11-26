/**
 * Header Component
 */

import { useNavigate } from "@tanstack/react-router";
import { LogOut, Menu } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { useAuth } from "@/contexts/auth-context";

interface HeaderProps {
  className?: string;
  /** Opens the navigation drawer. The button shows only below `md`, where the sidebar is hidden. */
  onOpenNavigation?: () => void;
  isNavigationOpen?: boolean;
}

export function Header({ className, onOpenNavigation, isNavigationOpen }: HeaderProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate({ to: "/auth/login" });
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <header
      className={`sticky top-0 z-30 flex h-16 items-center gap-4 border-b bg-background px-6 ${className || ""}`}
    >
      {onOpenNavigation && (
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 md:hidden"
          onClick={onOpenNavigation}
          aria-label="Open the navigation"
          aria-expanded={isNavigationOpen ?? false}
          aria-haspopup="dialog"
        >
          <Menu className="h-5 w-5" />
        </Button>
      )}

      {/*
       * No global search box here.
       *
       * There was one, and it did nothing: a form whose only handler was
       * `preventDefault()`, over an input bound to no state, placeholdered
       * "Search... (Ctrl+K)" — a shortcut that was never wired either. A
       * control that looks like it works and does not is worse than no
       * control, and this application already has the two searches that mean
       * something: the dashboard filters its own cards, and `ADToolbar`
       * searches the records of the entity on screen. There is no endpoint a
       * third, global one could call.
       */}
      <div className="flex-1" />

      {/* Actions */}
      <div className="flex items-center gap-2">
        {/* Notifications — the real list, read from this user's own audit
            trail. This used to be a bell with a permanent pulsing dot over a
            hard-coded "No new notifications", which told the user there was
            something to read and then that there was not. */}
        <NotificationBell />

        {/* Light / dark / system. The class lands on <html>, so this one
            control changes every screen rather than this header. */}
        <ThemeToggle />

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="relative h-9 w-9 rounded-full">
              <Avatar className="h-9 w-9">
                <AvatarImage src="" alt={user?.name || ""} />
                <AvatarFallback className="bg-primary text-primary-foreground">
                  {user ? getInitials(user.name) : "U"}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">{user?.name}</p>
                <p className="text-xs leading-none text-muted-foreground">{user?.email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout}>
              <LogOut className="mr-2 h-4 w-4" />
              <span>Log out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
