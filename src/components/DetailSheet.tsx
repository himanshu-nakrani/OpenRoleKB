"use client";

import { useEffect, useRef } from "react";
import { ChevronLeft } from "lucide-react";
import { DetailPane } from "@/components/DetailPane";
import type { ExaResult, RerankItem } from "@/types/job";

interface DetailSheetProps {
  exaResults: ExaResult[];
  reranked: RerankItem[];
  selectedIdx: number | null;
  onClose: () => void;
}

export function DetailSheet({ exaResults, reranked, selectedIdx, onClose }: DetailSheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (selectedIdx !== null) {
      if (!dialog.open) dialog.showModal();
    } else {
      if (dialog.open) dialog.close();
    }
  }, [selectedIdx]);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="fixed inset-0 m-0 w-full max-w-none h-full bg-surface p-6 overflow-y-auto backdrop:bg-ink/40 open:animate-slide-up"
    >
      <div className="max-w-2xl mx-auto">
        <button
          onClick={() => { dialogRef.current?.close(); onClose(); }}
          className="mb-4 flex items-center gap-1 text-small text-ink-soft hover:text-ink transition-colors"
        >
          <ChevronLeft size={14} strokeWidth={2} aria-hidden /> Back to results
        </button>
        <DetailPane exaResults={exaResults} reranked={reranked} selectedIdx={selectedIdx} />
      </div>
    </dialog>
  );
}
