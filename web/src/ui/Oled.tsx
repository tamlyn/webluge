import type { ReactNode } from "react";

// The Deluge's display: a name, a line about it and a readout.
export function Oled({
  title,
  subtitle,
  readout,
  children,
}: {
  title: string;
  subtitle?: string;
  readout?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="oled">
      <div className="oled-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="label">{subtitle}</p>}
        </div>
        {readout && <div className="readout">{readout}</div>}
      </div>
      {children}
    </div>
  );
}
