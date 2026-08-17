import { useTheme } from '@mui/material/styles';

const STROKE_WIDTH = 2;

export const ProgressRing = ({
  value,
  size = 18,
  done = false,
}: {
  value: number;
  size?: number;
  done?: boolean;
}) => {
  const theme = useTheme();
  const center = size / 2;
  const radius = (size - STROKE_WIDTH) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio = Math.min(1, Math.max(0, value / 100));

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden
      focusable="false"
      data-testid="progress-ring"
      data-done={done ? 'true' : 'false'}
    >
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke={theme.palette.divider}
        strokeWidth={STROKE_WIDTH}
      />
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke={done ? theme.palette.success.main : theme.palette.text.primary}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - ratio)}
        transform={`rotate(-90 ${center} ${center})`}
        data-testid="progress-ring-value"
      />
    </svg>
  );
};
