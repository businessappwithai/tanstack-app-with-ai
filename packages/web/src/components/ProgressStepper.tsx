"use client";

import { useNavigate } from "@tanstack/react-router";
import { Check } from "lucide-react";
import React from "react";
import { type ProjectStep, STEP_LABELS, STEP_ORDER, STEP_ROUTES } from "@/types/project";

// Derived from the step vocabulary so a new step is added in one place.
const steps: Array<{ key: ProjectStep; label: string; number: number }> = STEP_ORDER.map(
  (key, index) => ({ key, label: STEP_LABELS[key], number: index + 1 })
);

interface ProgressStepperProps {
  currentStep: ProjectStep;
  completedSteps?: ProjectStep[];
  onStepClick?: (step: ProjectStep) => void;
  /**
   * Pass the project id to get navigation for free — every step already knows
   * its own route, so a page need not repeat the mapping.
   */
  projectId?: string;
}

export function ProgressStepper({
  currentStep,
  completedSteps = [],
  onStepClick,
  projectId,
}: ProgressStepperProps) {
  const navigate = useNavigate();
  const currentIndex = steps.findIndex((s) => s.key === currentStep);

  const goToStep =
    onStepClick ??
    (projectId
      ? (step: ProjectStep) => {
          if (step === currentStep) return;
          void navigate({ to: STEP_ROUTES[step], params: { id: projectId } });
        }
      : undefined);

  return (
    <div className="px-6 py-8">
      <div className="flex items-center justify-between relative max-w-3xl mx-auto">
        {steps.map((step, index) => {
          const isCompleted = completedSteps.includes(step.key) || index < currentIndex;
          const isCurrent = step.key === currentStep;
          const isClickable = Boolean(goToStep) && (isCompleted || isCurrent);

          return (
            <React.Fragment key={step.key}>
              <div className="flex flex-col items-center z-10 gap-2">
                <button
                  type="button"
                  onClick={() => goToStep?.(step.key)}
                  disabled={!isClickable}
                  aria-label={`Step ${step.number}: ${step.label}${
                    isCompleted ? " (completed)" : isCurrent ? " (current)" : ""
                  }`}
                  aria-current={isCurrent ? "step" : undefined}
                  className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                    isCurrent
                      ? "bg-primary text-white ring-4 ring-primary/20"
                      : isCompleted
                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/50"
                        : "bg-muted border border-border text-muted-foreground"
                  } ${isClickable ? "cursor-pointer hover:scale-110" : "cursor-default"}`}
                >
                  {isCompleted ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <span className="text-xs font-bold">{step.number}</span>
                  )}
                </button>
                <span
                  className={`text-[10px] uppercase tracking-widest font-semibold ${
                    isCurrent
                      ? "text-primary"
                      : isCompleted
                        ? "text-emerald-400"
                        : "text-muted-foreground"
                  }`}
                >
                  {step.label}
                </span>
              </div>

              {index < steps.length - 1 && (
                <div
                  className={`flex-1 h-[2px] mx-1 -mt-6 ${
                    index < currentIndex ? "bg-primary" : "bg-border"
                  }`}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
