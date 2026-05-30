"use client";

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = "" }: SkeletonProps) {
  return (
    <div
      className={`rounded-lg bg-surface-2 animate-pulse ${className}`}
      aria-hidden="true"
    />
  );
}
