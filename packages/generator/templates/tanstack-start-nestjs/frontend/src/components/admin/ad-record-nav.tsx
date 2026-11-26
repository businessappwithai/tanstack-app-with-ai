import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ADRecordNavProps {
  currentIndex: number;
  totalCount: number;
  page: number;
  pageSize: number;
  canGoPrev: boolean;
  canGoNext: boolean;
  onFirst: () => void;
  onPrev: () => void;
  onNext: () => void;
  onLast: () => void;
}

export function ADRecordNav({
  currentIndex,
  totalCount,
  page,
  pageSize,
  canGoPrev,
  canGoNext,
  onFirst,
  onPrev,
  onNext,
  onLast,
}: ADRecordNavProps) {
  const globalPosition = (page - 1) * pageSize + currentIndex + 1;

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0"
        onClick={onFirst}
        disabled={!canGoPrev}
        aria-label="First record"
      >
        <ChevronsLeft className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0"
        onClick={onPrev}
        disabled={!canGoPrev}
        aria-label="Previous record"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>

      <span className="text-sm text-muted-foreground px-2 min-w-[80px] text-center tabular-nums">
        {totalCount === 0 ? "0 of 0" : `${globalPosition} of ${totalCount}`}
      </span>

      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0"
        onClick={onNext}
        disabled={!canGoNext}
        aria-label="Next record"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0"
        onClick={onLast}
        disabled={!canGoNext}
        aria-label="Last record"
      >
        <ChevronsRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
