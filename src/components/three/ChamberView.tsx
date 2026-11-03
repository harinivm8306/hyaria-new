"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { ChamberProps } from "./AeroChamber";

// three.js is ~600 KB: load it only in the browser, only when needed
const AeroChamber = dynamic(() => import("./AeroChamber"), {
  ssr: false,
  loading: () => <ChamberPlaceholder />,
});

function ChamberPlaceholder() {
  return (
    <div className="w-full h-full grid place-items-center">
      <div className="flex flex-col items-center gap-3 text-text-muted">
        <div className="w-10 h-10 rounded-full border-2 border-line border-t-primary animate-spin" />
        <span className="eyebrow">Loading digital twin</span>
      </div>
    </div>
  );
}

/** Wraps the 3D chamber: lazy-loads it and pauses rendering while it is off-screen. */
export default function ChamberView(props: Omit<ChamberProps, "active">) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [webgl, setWebgl] = useState(true);

  useEffect(() => {
    try {
      const c = document.createElement("canvas");
      setWebgl(!!(c.getContext("webgl2") || c.getContext("webgl")));
    } catch {
      setWebgl(false);
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={props.className}>
      {!webgl ? (
        <div className="w-full h-full grid place-items-center text-center p-6 text-sm text-text-muted">
          3D view needs WebGL, which this browser has turned off.
        </div>
      ) : (
        <AeroChamber {...props} className="w-full h-full" active={visible} />
      )}
    </div>
  );
}
