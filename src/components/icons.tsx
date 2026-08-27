import type { SVGProps } from 'react'

/**
 * Иконки артбордов D1, вписанные как есть. Библиотека иконок ради шести штук не заводится:
 * это шесть строк разметки против ещё одной зависимости в бандле.
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
