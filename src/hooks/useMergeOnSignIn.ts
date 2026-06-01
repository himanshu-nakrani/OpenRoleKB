"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";

export function useMergeOnSignIn() {
  const { status } = useSession();
  const merged = useRef(false);

  useEffect(() => {
    if (status !== "authenticated" || merged.current) return;
    const anonId = localStorage.getItem("openrolekb_anon_id");
    if (!anonId || !/^[0-9a-f]{8}-/.test(anonId)) return;

    merged.current = true;
    fetch("/api/auth/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anonId }),
    })
      .then(() => {
        localStorage.removeItem("openrolekb_anon_id");
        window.dispatchEvent(new CustomEvent("openrolekb:saved-changed"));
      })
      .catch(() => {});
  }, [status]);
}
