import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface MobileSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

export function MobileSidebar({ open, onOpenChange, children }: MobileSidebarProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/50 md:hidden" />
        <DialogPrimitive.Content
          className={cn(
            "fixed inset-y-0 left-0 z-50 h-full w-64 bg-background border-r border-border shadow-lg",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left",
            "duration-200 md:hidden"
          )}
          aria-describedby={undefined}
        >
          {/* A dialog must be named; Radix reports one without a Title as an error. */}
          <DialogPrimitive.Title className="sr-only">Navigation menu</DialogPrimitive.Title>
          <div className="flex flex-col h-full overflow-y-auto">{children}</div>
          <DialogPrimitive.Close asChild>
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-4 h-8 w-8"
              aria-label="Close navigation"
            >
              <X className="h-4 w-4" />
            </Button>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
