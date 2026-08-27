import { Link } from 'react-router'

import { AuthHeading, AuthLayout } from '@/components/AuthLayout'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <AuthLayout>
      <AuthHeading
        description="Такого адреса в приложении нет. Возможно, ссылка устарела."
        title="Страница не найдена"
      />
      <Button asChild className="w-full" size="lg">
        <Link to="/profile">На главную</Link>
      </Button>
    </AuthLayout>
  )
}
