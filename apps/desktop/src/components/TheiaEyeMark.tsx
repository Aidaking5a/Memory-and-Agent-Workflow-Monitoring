interface TheiaEyeMarkProps {
  size?: number;
}

export function TheiaEyeMark({ size = 36 }: TheiaEyeMarkProps) {
  return (
    <svg
      aria-hidden="true"
      className="theia-eye-logo"
      height={size}
      viewBox="0 0 128 128"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect fill="#090808" height="128" rx="24" width="128" />
      <rect fill="none" height="108" rx="18" stroke="#361212" strokeWidth="2" width="108" x="10" y="10" />
      <ellipse cx="64" cy="64" fill="#ff2e2e" rx="46" ry="28" />
      <ellipse cx="64" cy="64" fill="#070707" rx="22" ry="22" />
      <circle cx="64" cy="64" fill="#ff2e2e" r="10" />
    </svg>
  );
}
