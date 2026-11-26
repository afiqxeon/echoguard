import React from "react";

interface SpinnerIconProps {
  size?: number;
  color?: string;
}

export const SpinnerIcon: React.FC<SpinnerIconProps> = ({
  size = 14,
  color = "#0284c7",
}) => (
  <>
    <style>{`@keyframes echoguard-spin { to { transform: rotate(360deg); } }`}</style>
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        display: "inline-block",
        animation: "echoguard-spin 0.8s linear infinite",
      }}
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke={color}
        strokeWidth="3.5"
        strokeOpacity="0.25"
      />
      <path
        d="M22 12a10 10 0 0 0-10-10"
        stroke={color}
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </svg>
  </>
);
