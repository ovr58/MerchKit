import { Navigate, Route, Routes } from 'react-router'

import { RequireAnon, RequireAuth } from '@/features/auth'
import AuthCallback from '@/screens/AuthCallback'
import ConfirmEmail from '@/screens/ConfirmEmail'
import NotFound from '@/screens/NotFound'
import Profile from '@/screens/Profile'
import ResetNewPassword from '@/screens/ResetNewPassword'
import ResetRequest from '@/screens/ResetRequest'
import SignIn from '@/screens/SignIn'
import SignUp from '@/screens/SignUp'

/**
 * Карта маршрутов вехи M2 «Аккаунт».
 *
 * Три группы, и разница между ними — не в защите данных, а в том, кому какой экран
 * осмысленно показывать (данные защищает RLS, см. `features/auth/guards.tsx`):
 *
 *   - только гостю — вход и регистрация;
 *   - только авторизованному — профиль;
 *   - всем — экраны почтовых сценариев. Переход по ссылке из письма создаёт сессию,
 *     поэтому `/reset/new` и `/auth/callback` не могут жить под гвардом гостя.
 */
export default function App() {
  return (
    <Routes>
      <Route element={<Navigate replace to="/profile" />} path="/" />

      <Route element={<RequireAnon />}>
        <Route element={<SignIn />} path="/signin" />
        <Route element={<SignUp />} path="/signup" />
      </Route>

      <Route element={<ConfirmEmail />} path="/confirm-email" />
      <Route element={<ResetRequest />} path="/reset" />
      <Route element={<ResetNewPassword />} path="/reset/new" />
      <Route element={<AuthCallback />} path="/auth/callback" />

      <Route element={<RequireAuth />}>
        <Route element={<Profile />} path="/profile" />
      </Route>

      <Route element={<NotFound />} path="*" />
    </Routes>
  )
}
