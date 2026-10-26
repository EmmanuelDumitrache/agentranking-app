"use client";

import { useEffect } from "react";

export function useObjectUrlRevocation(url: string): void {
  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);
}
