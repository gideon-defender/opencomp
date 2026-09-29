const SHIELD_PATH =
  'M2 108.258V3C2 2.44772 2.44772 2 3 2H113C113.552 2 114 2.44772 114 3V108.258C114 108.58 113.845 108.882 113.583 109.07L58.5834 148.581C58.2348 148.831 57.7652 148.831 57.4166 148.581L2.41657 109.07C2.15505 108.882 2 108.58 2 108.258Z';

const SHORT_LABELS: Record<string, string> = {
  'SOC 2 Type 1': 'SOC 2',
  'SOC 2 Type 2': 'SOC 2',
  'SOC 3': 'SOC 3',
  DORA: 'DORA',
  'NIS 2': 'NIS 2',
  'HITRUST CSF': 'HITRUST',
  'NIST CSF': 'NIST',
  'NIST 800-53': 'NIST',
};

/**
 * Mini shield badge for a framework: flat single-color outline, dark text,
 * no gradients — per the website brand guidelines. In-progress frameworks
 * use a dashed outline and muted text.
 */
export function FrameworkShield({
  title,
  inProgress = false,
}: {
  title: string;
  inProgress?: boolean;
}) {
  const label = SHORT_LABELS[title] ?? title;
  const stroke = inProgress ? '#5b6470' : '#1a1d21';
  return (
    <svg
      width="44"
      height="56"
      viewBox="0 0 116 151"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        d={SHIELD_PATH}
        fill="white"
        stroke={stroke}
        strokeWidth="5"
        strokeDasharray={inProgress ? '10 7' : undefined}
      />
      <text
        x="58"
        y="80"
        textAnchor="middle"
        fontFamily="-apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif"
        fontWeight="800"
        fontSize="30"
        fill={inProgress ? '#5b6470' : '#1a1d21'}
        textLength="88"
        lengthAdjust="spacingAndGlyphs"
      >
        {label}
      </text>
    </svg>
  );
}
