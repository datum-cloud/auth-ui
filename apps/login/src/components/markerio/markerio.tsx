"use client";

import { useEffect } from "react";

// TypeScript declarations for Marker.io
declare global {
  interface Window {
    markerConfig?: {
      project: string;
      source: string;
    };
    __Marker?: Record<string, any>;
    Marker?: {
      show: (...args: any[]) => void;
      hide: (...args: any[]) => void;
      isVisible: (...args: any[]) => void;
      capture: (...args: any[]) => void;
      cancelCapture: (...args: any[]) => void;
      unload: (...args: any[]) => void;
      reload: (...args: any[]) => void;
      isExtensionInstalled: (...args: any[]) => void;
      setReporter: (...args: any[]) => void;
      clearReporter: (...args: any[]) => void;
      setCustomData: (...args: any[]) => void;
      on: (...args: any[]) => void;
      off: (...args: any[]) => void;
      __cs?: any[];
    };
  }
}

interface MarkerIoEmbedProps {
  projectId: string;
}

export default function MarkerIoEmbed({ projectId }: MarkerIoEmbedProps) {
  useEffect(() => {
    // Only run on client side
    if (typeof window === "undefined") return;

    // Config
    window.markerConfig = {
      project: projectId,
      source: "snippet",
    };

    // Load shim
    if (!window.__Marker) {
      window.__Marker = {};
      const queue: any[] = [];
      const markerStub: any = { __cs: queue };
      const methods = [
        "show",
        "hide",
        "isVisible",
        "capture",
        "cancelCapture",
        "unload",
        "reload",
        "isExtensionInstalled",
        "setReporter",
        "clearReporter",
        "setCustomData",
        "on",
        "off",
      ];

      methods.forEach((method) => {
        markerStub[method] = (...args: any[]) => {
          queue.push([method, ...args]);
        };
      });

      window.Marker = markerStub;

      const script = document.createElement("script");
      script.async = true;
      script.src = "https://edge.marker.io/latest/shim.js";

      // Add error handling
      script.onerror = () => {
        console.warn("Failed to load Marker.io script");
      };

      document.body.appendChild(script);
    }
  }, [projectId]);

  return null;
}
