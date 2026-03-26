"use client";

import React, { createContext, useContext, useEffect, useRef } from "react";
import { TogulClient } from "../client";
import type { TogulConfig } from "../types";

interface TogulContextValue {
  client: TogulClient;
}

const TogulContext = createContext<TogulContextValue | null>(null);

export interface TogulProviderProps {
  config: TogulConfig;
  /** Enable SSE streaming for real-time cache invalidation */
  stream?: boolean;
  children: React.ReactNode;
}

export function TogulProvider({ config, stream = false, children }: TogulProviderProps) {
  const clientRef = useRef<TogulClient | null>(null);

  if (!clientRef.current) {
    clientRef.current = new TogulClient(config);
  }

  useEffect(() => {
    if (stream) {
      clientRef.current?.startStream();
      return () => clientRef.current?.stopStream();
    }
  }, [stream]);

  return (
    <TogulContext.Provider value={{ client: clientRef.current }}>
      {children}
    </TogulContext.Provider>
  );
}

export function useTogulClient(): TogulClient {
  const ctx = useContext(TogulContext);
  if (!ctx) {
    throw new Error("@togul/sdk-next: useTogulClient must be used within <TogulProvider>");
  }
  return ctx.client;
}
