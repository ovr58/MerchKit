import type { SVGProps } from 'react'

/**
 * Иконки артбордов D1 и D2, вписанные как есть. Библиотека иконок ради десятка штук не
 * заводится: это десяток строк разметки против ещё одной зависимости в бандле.
 *
 * Все — декоративные (`aria-hidden`): смысл несёт текст рядом, а не рисунок.
 */

type IconProps = SVGProps<SVGSVGElement>

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      focusable="false"
      height="24"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="24"
      {...props}
    >
      {children}
    </svg>
  )
}

export function BoxIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m21 8-9-5-9 5v8l9 5 9-5Z" />
      <path d="m3 8 9 5 9-5" />
      <path d="M12 13v8" />
    </Icon>
  )
}

export function EyeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  )
}

export function EyeOffIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10.6 5.1A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a17.8 17.8 0 0 1-3.2 4.2" />
      <path d="M6.6 6.6A17.8 17.8 0 0 0 2 12s3.5 7 10 7a10.9 10.9 0 0 0 4.4-.9" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="m2 2 20 20" />
    </Icon>
  )
}

export function AlertCircleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16h.01" />
    </Icon>
  )
}

export function MailIcon(props: IconProps) {
  return (
    <Icon strokeWidth="1.75" {...props}>
      <rect height="16" rx="2" width="20" x="2" y="4" />
      <path d="m2 7 10 6 10-6" />
    </Icon>
  )
}

export function CoinIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10M9.5 9.5h3.5a1.75 1.75 0 0 1 0 3.5H9.5" />
    </Icon>
  )
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 6 9 17l-5-5" />
    </Icon>
  )
}

export function ImageIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect height="18" rx="2" width="18" x="3" y="3" />
      <circle cx="8.5" cy="9" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </Icon>
  )
}

export function UploadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </Icon>
  )
}

export function DownloadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 4v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </Icon>
  )
}

export function AlertTriangleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3 2 20h20L12 3Z" />
      <path d="M12 10v4M12 17h.01" />
    </Icon>
  )
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M18 6 6 18M6 6l12 12" />
    </Icon>
  )
}

export function SparkIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
      <path d="M7.5 7.5 5 5M16.5 7.5 19 5M7.5 16.5 5 19M16.5 16.5 19 19" />
    </Icon>
  )
}
